import { changeSummary, isNumericCell, normaliseMoney, tidyMarkdown, toolProgress } from "./aiFormat";

describe("tidyMarkdown", () => {
  test("unwraps bold around amounts and moves a trailing euro to the front", () => {
    expect(tidyMarkdown("You spent **2.00€** today")).toBe("You spent €2.00 today");
    expect(tidyMarkdown("Total: **€1,250.00**.")).toBe("Total: €1,250.00.");
    expect(tidyMarkdown("It cost 14,50 € at the shop")).toBe("It cost €14.50 at the shop");
    expect(tidyMarkdown("Balance -5.00€")).toBe("Balance -€5.00");
    expect(tidyMarkdown("paid € 14.00")).toBe("paid €14.00");
    expect(tidyMarkdown("`3 kg` of rice")).toBe("3 kg of rice");
  });
  test("keeps real bold labels and closes ones that touch a word", () => {
    expect(tidyMarkdown("**Groceries** are up")).toBe("**Groceries** are up");
    expect(tidyMarkdown("**Total:**Next")).toBe("**Total:** Next");
  });
  test("hides a half-typed bold marker while streaming only", () => {
    expect(tidyMarkdown("You have **3 over", { streaming: true })).toBe("You have 3 over");
    expect(tidyMarkdown("You have **3 over", { streaming: false })).toBe("You have **3 over");
    expect(tidyMarkdown("A **b** c", { streaming: true })).toBe("A **b** c");
  });
});

describe("figures", () => {
  test("money is padded to two decimals", () => {
    expect(normaliseMoney("€14.5")).toBe("€14.50");
    expect(normaliseMoney("-€3")).toBe("-€3");
    expect(normaliseMoney("€1,250.00")).toBe("€1,250.00");
  });
  test("numeric table cells are detected", () => {
    expect(isNumericCell("€9.58")).toBe(true);
    expect(isNumericCell(" 83 kg ")).toBe(true);
    expect(isNumericCell("Uber Eats")).toBe(false);
  });
});

describe("tool activity", () => {
  test("labels progress and summarises only successful writes", () => {
    expect(toolProgress("get_tasks")).toBe("Checking tasks…");
    expect(toolProgress("create_task")).toBe("Added a task…");
    expect(changeSummary([
      { tool: "create_task" }, { tool: "create_task" }, { tool: "get_tasks" }, { tool: "delete_task", error: "nope" },
    ])).toEqual(["Added a task ×2"]);
  });
});

describe("nutrition tools", () => {
  test("lookups are not reported as changes, but logging and planning are", () => {
    const actions = [{ tool: "search_foods" }, { tool: "lookup_barcode" }, { tool: "suggest_food_swaps" }, { tool: "get_nutrition_day" },
      { tool: "log_food" }, { tool: "log_food" }, { tool: "plan_meal" }, { tool: "set_nutrition_target", error: "refused" }];
    expect(changeSummary(actions)).toEqual(["Logged food ×2", "Planned a meal"]);
  });
  test("progress text says what is being done", () => {
    expect(toolProgress("search_foods")).toBe("Searching foods…");
    expect(toolProgress("get_nutrition_day")).toBe("Checking your day's food…");
    expect(toolProgress("log_water")).toBe("Logged a drink…");
  });
});
