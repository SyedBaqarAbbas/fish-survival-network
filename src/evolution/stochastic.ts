import { SeededRandom } from "@/simulation/random";

export function gaussianRandom(random: SeededRandom) {
  const first = 1 - random.next();
  const second = random.next();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}
