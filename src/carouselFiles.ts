/** Where a carousel's slide images live in the private `carousels` bucket. */
export function slidePath(carouselId: string, index: number, type: string): string {
  return `${carouselId}/${String(index + 1).padStart(2, "0")}-${type}.png`;
}

export function expectedPaths(carouselId: string, slideTypes: string[]): string[] {
  return slideTypes.map((type, i) => slidePath(carouselId, i, type));
}

/** 1 based numbers of slides whose image is not in the bucket. */
export function missingSlides(expected: string[], present: string[]): number[] {
  const have = new Set(present);
  return expected.flatMap((p, i) => (have.has(p) ? [] : [i + 1]));
}
