"""Minimal TN3270 host: telnet-negotiates, then emits ONE hand-built 3270
data stream. It is a byte emitter, not a 3270 implementation -- s3270 does all
the interpreting. That asymmetry is the point of the experiment."""
import socket, sys, threading

IAC,DONT,DO,WONT,WILL,SB,SE,EOR = 255,254,253,252,251,250,240,239
TTYPE,EOR_OPT,BINARY = 24,25,0

# 12-bit buffer-address code table (3270 data stream, GA23-0059)
CODE = bytes([
 0x40,0xC1,0xC2,0xC3,0xC4,0xC5,0xC6,0xC7,0xC8,0xC9,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,
 0x50,0xD1,0xD2,0xD3,0xD4,0xD5,0xD6,0xD7,0xD8,0xD9,0x5A,0x5B,0x5C,0x5D,0x5E,0x5F,
 0x60,0x61,0xE2,0xE3,0xE4,0xE5,0xE6,0xE7,0xE8,0xE9,0x6A,0x6B,0x6C,0x6D,0x6E,0x6F,
 0xF0,0xF1,0xF2,0xF3,0xF4,0xF5,0xF6,0xF7,0xF8,0xF9,0x7A,0x7B,0x7C,0x7D,0x7E,0x7F])

def sba(row, col):           # 0-indexed row/col on a 24x80 screen
    a = row*80 + col
    return bytes([0x11, CODE[(a >> 6) & 0x3F], CODE[a & 0x3F]])
def sf(attr):  return bytes([0x1D, attr])
def e(s):      return s.encode('cp037')

PROT, UNPROT, UNPROT_HIDDEN, PROT_INTENS = 0x60, 0x40, 0x4C, 0xF8

def screen():
    b = bytearray()
    b += bytes([0xF5, 0xC3])                       # Erase/Write + WCC(restore,reset MDT)
    b += sba(0, 25) + sf(PROT_INTENS) + e("ORBIT TEST HOST")
    b += sba(3, 2)  + sf(PROT)   + e("USERID   ===>")
    b += sba(3, 17) + sf(UNPROT) + e(" " * 8)
    b += sba(3, 26) + sf(PROT)                     # field-ending attribute
    b += sba(5, 2)  + sf(PROT)   + e("PASSWORD ===>")
    b += sba(5, 17) + sf(UNPROT_HIDDEN) + e(" " * 8)
    b += sba(5, 26) + sf(PROT)
    b += sba(8, 2)  + sf(PROT)   + e("STATUS: READY")
    b += sba(3, 18) + bytes([0x13])                # Insert Cursor into userid field
    return bytes(b)

def serve(conn):
    conn.sendall(bytes([IAC,DO,TTYPE]))
    buf = b''
    while b'\xff\xfa\x18\x00' not in buf:          # wait for TERMINAL-TYPE IS
        d = conn.recv(4096)
        if not d: return
        buf += d
        if buf.count(bytes([IAC,WILL,TTYPE])) and bytes([IAC,SB,TTYPE,1,IAC,SE]) not in buf:
            conn.sendall(bytes([IAC,SB,TTYPE,1,IAC,SE]))   # SEND
    print("negotiated ttype:", buf.split(b'\xff\xfa\x18\x00')[1].split(b'\xff\xf0')[0].decode('ascii','replace'), file=sys.stderr)
    conn.sendall(bytes([IAC,DO,EOR_OPT, IAC,WILL,EOR_OPT, IAC,DO,BINARY, IAC,WILL,BINARY]))
    import time; time.sleep(0.4)
    conn.sendall(screen() + bytes([IAC,EOR]))
    print("sent %d-byte data stream" % len(screen()), file=sys.stderr)
    try:
        while conn.recv(4096): pass
    except OSError: pass

s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR,1)
s.bind(('127.0.0.1', 3271)); s.listen(1)
print("listening on 3271", file=sys.stderr); sys.stderr.flush()
c,_ = s.accept(); serve(c)
