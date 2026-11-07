import { expect, test } from "nsh/test";
import type { InputRef } from "nsh";
import * as store from "./appStore";
import { blurSearch, focusSearch, setSearchField } from "./searchFocus";

// The headless test host does not model an input's selection, so the one
// place that can observe "select the whole query" is the ref it is sent to.
function fakeField() {
  const calls: string[] = [];
  const ref = {
    focus: () => calls.push("focus"),
    blur: () => calls.push("blur"),
    setSelection: (start: number, end?: number) => calls.push(`select ${start}..${end ?? start}`),
  } as unknown as InputRef;
  return { calls, ref };
}

test("focusing the search clears the action focus and focuses the field", () => {
  const { calls, ref } = fakeField();
  setSearchField(ref);
  store.focusedAction.set("action:somewhere");

  focusSearch();

  expect(store.focusedAction()).toBe(null);
  expect(calls).toEqual(["focus"]);
});

test("asking for the query selects all of it", () => {
  const { calls, ref } = fakeField();
  setSearchField(ref);
  store.setSearch("github");

  focusSearch(true);

  expect(calls).toEqual(["focus", "select 0..6"]);
  store.setSearch("");
});

test("a plain focus leaves the query alone", () => {
  const { calls, ref } = fakeField();
  setSearchField(ref);
  store.setSearch("git");

  focusSearch();

  expect(calls).toEqual(["focus"]);
  store.setSearch("");
});

test("blurring takes the keyboard out of the field", () => {
  const { calls, ref } = fakeField();
  setSearchField(ref);

  blurSearch();

  expect(calls).toEqual(["blur"]);
});
