import { cn } from "@/lib/utils";

type Ink = "red" | "yellow" | "contrast";

/**
 * The pattern, fixed once: [x, width, ink] on a 140 × 12 grid, two rows of 4 px strokes
 * with round caps. A width of 4 is a dot. Deterministic on purpose: the same motif on
 * every render, on the server and in screenshots.
 */
const ROWS: ReadonlyArray<ReadonlyArray<readonly [number, number, Ink]>> = [
  [
    [0, 30, "red"],
    [36, 4, "yellow"],
    [46, 18, "red"],
    [70, 4, "contrast"],
    [80, 34, "yellow"],
    [120, 20, "red"],
  ],
  [
    [0, 18, "red"],
    [24, 26, "contrast"],
    [56, 4, "red"],
    [66, 38, "red"],
    [110, 4, "yellow"],
    [120, 14, "red"],
  ],
];

interface TrameProps {
  /**
   * Surface the motif sits on. On navy: red, yellow and white strokes. On a light surface
   * yellow would be a thin line at 1.42:1, so the yellow and white strokes are navy there.
   */
  surface?: "navy" | "light";
  className?: string;
}

/**
 * The « trame »: two rows of short rounded dashes and dots, like a stylised rail line —
 * the motif of the « Occitanie en train » identity. Purely decorative (`aria-hidden`), so
 * the 2.66:1 of red on navy is acceptable here and nowhere else. Use it sparingly: once,
 * under the page title (docs/DESIGN.md §4). Size it with a width class; the height follows.
 */
export function Trame({ surface = "navy", className }: TrameProps) {
  const fill: Record<Ink, string> =
    surface === "navy"
      ? { red: "fill-action", yellow: "fill-highlight", contrast: "fill-primary-foreground" }
      : { red: "fill-action", yellow: "fill-primary", contrast: "fill-primary" };
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 140 12"
      className={cn("block h-auto shrink-0", className)}
      data-testid="trame"
    >
      {ROWS.map((row, rowIndex) =>
        row.map(([x, width, ink]) => (
          <rect key={`${rowIndex}-${x}`} x={x} y={rowIndex * 8} width={width} height={4} rx={2} className={fill[ink]} />
        )),
      )}
    </svg>
  );
}
