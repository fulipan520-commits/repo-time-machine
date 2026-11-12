// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { fixtureBundle } from "./fixture";
import { GraphWorkspace } from "./graph-workspace";

it("changes the evidence when a timeline keyframe is selected", async () => {
  const user = userEvent.setup();
  render(<GraphWorkspace bundle={fixtureBundle} />);

  await user.click(
    screen.getByRole("button", { name: /add database module/i }),
  );

  expect(screen.getAllByText("src/db").length).toBeGreaterThan(0);
  expect(screen.getByText("提交证据")).toBeVisible();
  expect(screen.getByText("add database module")).toBeVisible();
});
