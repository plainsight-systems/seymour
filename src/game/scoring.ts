export function gradeFor(score: number, target: number, misses = 0, fuses = 3): 'S' | 'A' | 'B' | 'C' {
  const ratio = score / Math.max(1, target);
  if (misses === 0 && fuses === 3 && ratio >= 1.08) return 'S';
  if (misses === 0 && ratio >= 0.95) return 'A';
  if (misses <= 1 && ratio >= 0.85) return 'B';
  return 'C';
}
