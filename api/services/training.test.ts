import { describe, expect, it } from "vitest";
import { moduleKeyFromTitle, validateQuiz } from "./training";

const ok = { question: "When does this product pay?", options: ["After signup", "After the first deposit"], answerIndex: 1 };

describe("validateQuiz", () => {
  it("accepts a well-formed quiz", () => {
    expect(validateQuiz([ok])).toBeNull();
  });
  it("needs at least one question", () => {
    expect(validateQuiz([])).toMatch(/at least one/);
  });
  it("rejects a short question", () => {
    expect(validateQuiz([{ ...ok, question: "Why" }])).toMatch(/Question 1 is too short/);
  });
  it("needs two answers", () => {
    expect(validateQuiz([{ ...ok, options: ["Only one"], answerIndex: 0 }])).toMatch(/two answers/);
  });
  it("rejects empty and duplicate answers", () => {
    expect(validateQuiz([{ ...ok, options: ["A", "  "] }])).toMatch(/empty answer/);
    expect(validateQuiz([{ ...ok, options: ["Yes", " yes "] }])).toMatch(/same answer twice/);
  });
  it("needs the correct answer to be one of the answers", () => {
    expect(validateQuiz([{ ...ok, answerIndex: 2 }])).toMatch(/correct answer for question 1/);
    expect(validateQuiz([{ ...ok, answerIndex: -1 }])).toMatch(/correct answer/);
  });
  it("names the question that's wrong", () => {
    expect(validateQuiz([ok, { ...ok, options: ["A", "A"] }])).toMatch(/Question 2/);
  });
});

describe("moduleKeyFromTitle", () => {
  it("makes a readable, unique key", () => {
    const a = moduleKeyFromTitle("Selling the Kuda student account!");
    const b = moduleKeyFromTitle("Selling the Kuda student account!");
    expect(a).toMatch(/^selling-the-kuda-student-account-[a-z0-9]{6}$/);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(80);
  });
  it("falls back when the title has no letters", () => {
    expect(moduleKeyFromTitle("!!!")).toMatch(/^lesson-/);
  });
});
