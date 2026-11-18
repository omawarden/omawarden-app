import { expect, test } from "nsh/test";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  lengthText,
  stepLength,
  steppedLength,
  steppedWords,
  wordsText,
} from "./generatorOptions";

test("the length stepper stays inside the allowed range", () => {
  lengthText.set("20");
  expect(steppedLength(1)).toBe(21);
  expect(steppedLength(-1)).toBe(19);

  // A press at an end does not move past it.
  lengthText.set("5");
  expect(steppedLength(-1)).toBe(MIN_PASSWORD_LENGTH);
  lengthText.set("128");
  expect(steppedLength(1)).toBe(MAX_PASSWORD_LENGTH);

  // A typed value outside the range snaps into it on the first press.
  lengthText.set("4");
  expect(steppedLength(1)).toBe(MIN_PASSWORD_LENGTH);
  lengthText.set("129");
  expect(steppedLength(-1)).toBe(MAX_PASSWORD_LENGTH);
  lengthText.set("abc");
  expect(steppedLength(1)).toBe(21);

  lengthText.set("20");
  stepLength(2);
  expect(lengthText()).toBe("22");
});

test("the word stepper follows the same rule", () => {
  wordsText.set("5");
  expect(steppedWords(1)).toBe(6);
  wordsText.set("3");
  expect(steppedWords(-1)).toBe(3);
  wordsText.set("20");
  expect(steppedWords(1)).toBe(20);
});
