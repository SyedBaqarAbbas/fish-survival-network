import type { CurriculumLevel } from "@/simulation/types";

const INPUTS_UNLOCKED_BY_LEVEL = Object.freeze([
  Object.freeze([0]),
  Object.freeze([1]),
  Object.freeze([2, 3]),
  Object.freeze([4]),
  Object.freeze([5, 6]),
  Object.freeze([7, 8]),
  Object.freeze([9, 10]),
] as const);

export function getInputsUnlockedAtLevel(level: CurriculumLevel): readonly number[] {
  return INPUTS_UNLOCKED_BY_LEVEL[level];
}

export function getUnlockedInputIndices(level: CurriculumLevel) {
  return INPUTS_UNLOCKED_BY_LEVEL.slice(0, level + 1).flat();
}

export function isInputUnlocked(inputIndex: number, level: CurriculumLevel) {
  return getUnlockedInputIndices(level).includes(inputIndex);
}
