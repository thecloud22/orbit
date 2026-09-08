import type { FieldAttributes, Screen, ScreenField } from '@orbit/screen-mapping';

/**
 * Turning `ReadBuffer(Ascii)` output into Orbit's `Screen`.
 *
 * b3270 answers with one string per row. Field starts appear as `SF(c0=xx)`
 * where `xx` is the 3270 field attribute byte; every other token is a character
 * code in hex, and `00` is an unwritten position.
 *
 * The attribute bits are from the 3270 data stream architecture (GA23-0059):
 *
 * ```text
 *   0x20  protected
 *   0x10  numeric
 *   0x0c  display/intensity -- 0x0c means non-display, 0x08 means intensified
 * ```
 *
 * This is the one place Orbit interprets anything 3270-shaped, and it is
 * deliberately the smallest possible place: a bit test over a byte the reference
 * implementation already decoded, not a data-stream parser.
 */

const SF_PATTERN = /^SF\(c0=([0-9a-f]{2})\)$/i;

export function attributesFrom(byte: number): FieldAttributes {
  const intensity = byte & 0x0c;

  return {
    protected: (byte & 0x20) !== 0,
    numeric: (byte & 0x10) !== 0,
    nonDisplay: intensity === 0x0c,
    intensified: intensity === 0x08,
  };
}

/**
 * Parses the rows b3270 returned into fields.
 *
 * A field runs from its attribute byte to the next one, wrapping across rows the
 * way the buffer itself does — a 3270 field is a run of buffer positions, not a
 * run within a line, and treating rows as independent would split every field
 * that reaches the right margin.
 */
export function parseReadBuffer(
  rows: readonly string[],
  cursor: { readonly row: number; readonly column: number } | null,
): Screen {
  const columns = rows[0]?.trim().split(/\s+/).length ?? 80;
  const fields: ScreenField[] = [];
  let current: { field: ScreenField; text: string[] } | undefined;

  function flush(): void {
    if (current === undefined) return;
    fields.push({ ...current.field, text: current.text.join('').replace(/\s+$/, '') });
    current = undefined;
  }

  rows.forEach((row, rowIndex) => {
    const tokens = row.trim().length === 0 ? [] : row.trim().split(/\s+/);

    tokens.forEach((token, columnIndex) => {
      const start = SF_PATTERN.exec(token);

      if (start?.[1] !== undefined) {
        flush();
        current = {
          field: {
            // The field's content begins after the attribute position.
            start: { row: rowIndex, column: columnIndex + 1 },
            length: 0,
            attributes: attributesFrom(Number.parseInt(start[1], 16)),
            text: '',
          },
          text: [],
        };
        return;
      }

      if (current === undefined) {
        return;
      }

      const code = Number.parseInt(token, 16);
      current.text.push(Number.isNaN(code) || code === 0 ? ' ' : String.fromCharCode(code));
      current.field = { ...current.field, length: current.field.length + 1 };
    });
  });

  flush();

  return { rows: rows.length, columns, fields, cursor };
}
