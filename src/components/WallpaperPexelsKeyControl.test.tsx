/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import { WallpaperPexelsKeyControl } from "./WallpaperPexelsKeyControl";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("WallpaperPexelsKeyControl", () => {
  const t = (key: string) => key;

  it("clears the credential from the input as soon as saving starts", async () => {
    const pending = deferred<boolean>();
    const save = vi.fn((_key: string) => pending.promise);

    function Harness() {
      const [hasKey, setHasKey] = useState(false);
      return (
        <WallpaperPexelsKeyControl
          t={t as never}
          hasKey={hasKey}
          invalid={false}
          disabled={false}
          onSave={async (key) => {
            const saved = await save(key);
            if (saved) setHasKey(true);
            return saved;
          }}
          onRequestDelete={vi.fn()}
        />
      );
    }

    render(<Harness />);
    const input = screen.getByLabelText(
      "settings.wallpaperSource.pexels.keyPlaceholder",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "pexels-test-key" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.pexels.keySave",
      }),
    );

    expect(save).toHaveBeenCalledWith("pexels-test-key");
    expect(input.value).toBe("");
    expect(
      screen.getByText("settings.wallpaperSource.pexels.keySaving"),
    ).toBeTruthy();

    pending.resolve(true);
    await waitFor(() =>
      expect(
        screen.getByText("settings.wallpaperSource.pexels.keySaved"),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByLabelText(
        "settings.wallpaperSource.pexels.keyPlaceholder",
      ),
    ).toBeNull();
  });

  it("opens replacement input when a saved key is rejected", () => {
    render(
      <WallpaperPexelsKeyControl
        t={t as never}
        hasKey
        invalid
        disabled={false}
        onSave={vi.fn(async () => true)}
        onRequestDelete={vi.fn()}
      />,
    );

    expect(
      screen.getByText("settings.wallpaperSource.pexels.keyInvalid"),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        "settings.wallpaperSource.pexels.keyPlaceholder",
      ),
    ).toBeTruthy();
  });

  it("requests confirmation instead of clearing a saved key directly", () => {
    const requestDelete = vi.fn();
    render(
      <WallpaperPexelsKeyControl
        t={t as never}
        hasKey
        invalid={false}
        disabled={false}
        onSave={vi.fn(async () => true)}
        onRequestDelete={requestDelete}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.pexels.keyDelete",
      }),
    );
    expect(requestDelete).toHaveBeenCalledTimes(1);
  });
});
