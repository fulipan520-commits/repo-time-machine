import { expect, test } from "@playwright/test";

test("opens the sample repository and follows architecture evidence", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /看清代码/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "先用示例仓库看看" }).click();
  await expect(
    page.getByRole("heading", { name: /northstar.*atlas-notes/i }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "add database module", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "提交证据" })).toBeVisible();
  await expect(page.getByText("add database module")).toBeVisible();

  await page.getByRole("button", { name: "src/db", exact: true }).last().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "db", exact: true })).toBeVisible();
});

test("keeps the analysis workspace usable on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "先用示例仓库看看" }).click();

  await expect(page.getByRole("heading", { name: "提交证据" })).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "选择架构时间点" }),
  ).toBeVisible();
});
