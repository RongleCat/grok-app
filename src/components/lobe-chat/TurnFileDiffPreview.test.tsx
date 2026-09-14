/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnFileDiffPreview } from "./TurnFileDiffPreview";

afterEach(cleanup);

const PATCH = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-old
+new
`;

describe("TurnFileDiffPreview copy", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("copies the unified patch", async () => {
    render(
      <TurnFileDiffPreview patch={PATCH} locale="en" />,
    );
    fireEvent.click(screen.getByTestId("turn-file-copy-diff"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(PATCH);
    });
  });

  it("hides copy when there is no patch", () => {
    render(<TurnFileDiffPreview patch={null} locale="en" />);
    expect(screen.queryByTestId("turn-file-copy-diff")).toBeNull();
  });
});
