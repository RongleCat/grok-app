/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import {
  WallpaperImagineControls,
  type WallpaperImagineControlsModel,
} from "./WallpaperImagineControls";

vi.mock("@/components/Select", () => ({
  Select: ({
    value,
    options,
    disabled,
    onChange,
    "aria-label": ariaLabel,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    disabled?: boolean;
    onChange: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        const next = options.find((option) => option.value !== value);
        if (next) onChange(next.value);
      }}
    >
      {options.find((option) => option.value === value)?.label ?? value}
    </button>
  ),
}));

afterEach(cleanup);

function model(
  overrides: Partial<WallpaperImagineControlsModel> = {},
): WallpaperImagineControlsModel {
  return {
    mode: "image",
    prompt: "",
    aspect: "16:9",
    aspectOptions: [
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
    ],
    videoDuration: 6,
    videoResolution: "480p",
    videoSource: null,
    videoSourcePath: null,
    videoSourcePreview: null,
    videoSourceStatus: "idle",
    generating: false,
    cancelling: false,
    onModeChange: vi.fn(),
    onPromptChange: vi.fn(),
    onAspectChange: vi.fn(),
    onVideoDurationChange: vi.fn(),
    onVideoResolutionChange: vi.fn(),
    onClearVideoSource: vi.fn(),
    onUploadSource: vi.fn(),
    onGenerate: vi.fn(),
    onCancelGeneration: vi.fn(),
    ...overrides,
  };
}

const t = ((key: string, vars?: Record<string, unknown>) =>
  vars?.seconds
    ? `${key}:${vars.seconds}`
    : key === "policy.auto"
      ? "Auto (localized)"
      : key) as never;

describe("WallpaperImagineControls", () => {
  it("requires both an image and instructions for editing and offers upload", () => {
    const onUploadSource = vi.fn();
    const edit = model({ mode: "edit", videoSourcePath: "/source.png", videoSourceStatus: "ready", onUploadSource });
    const view = render(<WallpaperImagineControls t={t} locked={false} model={edit} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "settings.wallpaperSource.editImage" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "settings.wallpaperSource.uploadImage" }));
    expect(onUploadSource).toHaveBeenCalledOnce();
    view.rerender(<WallpaperImagineControls t={t} locked={false} model={{ ...edit, prompt: "Make the sky blue" }} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "settings.wallpaperSource.editImage" }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "settings.wallpaperSource.aspect" }));
    expect(edit.onAspectChange).toHaveBeenCalledWith("9:16");
    view.rerender(<WallpaperImagineControls t={t} locked={true} model={{ ...edit, generating: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(edit.onCancelGeneration).toHaveBeenCalledOnce();
  });
  it("switches between image and video modes", () => {
    const onModeChange = vi.fn();
    render(
      <WallpaperImagineControls
        t={t}
        locked={false}
        model={model({ onModeChange })}
      />,
    );

    expect(
      screen.getByPlaceholderText("settings.wallpaperSource.imaginePlaceholder"),
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", {
        name: "settings.wallpaperSource.imaginePlaceholder",
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("radio", {
        name: "settings.wallpaperSource.kind.video",
      }),
    );
    expect(onModeChange).toHaveBeenCalledWith("video");
  });

  it("localizes the automatic aspect option", () => {
    render(
      <WallpaperImagineControls
        t={t}
        locked={false}
        model={model({
          aspect: "auto",
          aspectOptions: [
            { value: "16:9", label: "16:9" },
            { value: "auto", label: "auto" },
          ],
        })}
      />,
    );

    expect(screen.getByText("Auto (localized)")).toBeTruthy();
  });

  it("requires a prepared source and exposes supported video options", () => {
    const onVideoDurationChange = vi.fn();
    const onVideoResolutionChange = vi.fn();
    const view = render(
      <WallpaperImagineControls
        t={t}
        locked={false}
        model={model({
          mode: "video",
          onVideoDurationChange,
          onVideoResolutionChange,
        })}
      />,
    );

    expect(
      screen.getByText("settings.wallpaperSource.videoSourceMissing"),
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", {
        name: "settings.wallpaperSource.videoPromptPlaceholder",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "settings.wallpaperSource.generateVideo",
      }).disabled,
    ).toBe(true);

    view.rerender(
      <WallpaperImagineControls
        t={t}
        locked={false}
        model={model({
          mode: "video",
          videoSource: {
            id: "source",
            thumbUrl: "file:///wallpapers/source.jpg",
            fullUrl: "file:///wallpapers/source.jpg",
            kind: "image",
            source: "library",
            localPath: "C:\\wallpapers\\source.jpg",
          },
          videoSourcePath: "C:\\wallpapers\\source.jpg",
          videoSourceStatus: "ready",
          onVideoDurationChange,
          onVideoResolutionChange,
        })}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "settings.wallpaperSource.generateVideo",
      }).disabled,
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.videoDuration",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.videoResolution",
      }),
    );
    expect(onVideoDurationChange).toHaveBeenCalledWith(10);
    expect(onVideoResolutionChange).toHaveBeenCalledWith("720p");
  });

  it("shows the automatic video prompt as normal editable text", () => {
    const onPromptChange = vi.fn();
    render(
      <WallpaperImagineControls
        t={t}
        locked={false}
        model={model({
          mode: "video",
          prompt: "Slow cinematic push-in",
          onPromptChange,
        })}
      />,
    );

    const textarea = screen.getByRole("textbox", {
      name: "settings.wallpaperSource.videoPromptPlaceholder",
    });
    expect((textarea as HTMLTextAreaElement).value).toBe(
      "Slow cinematic push-in",
    );
    fireEvent.change(textarea, { target: { value: "Gentle camera orbit" } });
    expect(onPromptChange).toHaveBeenCalledWith("Gentle camera orbit");
  });

  it("never loads an unprepared remote source URL in the renderer", () => {
    const remote = {
      id: "saved-source",
      thumbUrl: "https://assets.grok.com/generated/source.jpg",
      fullUrl: "https://assets.grok.com/generated/source.jpg",
      kind: "image",
      source: "grok_album",
    };
    const view = render(
      <WallpaperImagineControls
        t={t}
        locked={false}
        model={model({
          mode: "video",
          videoSource: remote,
          videoSourceStatus: "preparing",
        })}
      />,
    );

    expect(view.container.querySelector("img")).toBeNull();
    view.rerender(
      <WallpaperImagineControls
        t={t}
        locked={false}
        model={model({
          mode: "video",
          videoSource: remote,
          videoSourcePreview: "data:image/jpeg;base64,cHJldmlldw==",
          videoSourceStatus: "preparing",
        })}
      />,
    );
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/jpeg;base64,cHJldmlldw==",
    );
  });

  it("keeps generation disabled while a separate cancel action is available", () => {
    const onCancelGeneration = vi.fn();
    render(
      <WallpaperImagineControls
        t={t}
        locked
        model={model({
          mode: "video",
          generating: true,
          onCancelGeneration,
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "common.cancel" }),
    );
    expect(onCancelGeneration).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "settings.wallpaperSource.generateVideo",
      }).disabled,
    ).toBe(true);
  });

  it.each(["image", "edit", "video"] as const)(
    "does not turn a delayed cancel click into another %s generation",
    async (mode) => {
      const user = userEvent.setup();
      const active = model({
        mode,
        prompt: "A quiet lake",
        videoSourcePath: "/source.png",
        videoSourceStatus: "ready",
        generating: true,
      });
      const view = render(
        <WallpaperImagineControls t={t} locked model={active} />,
      );
      const cancel = screen.getByRole<HTMLButtonElement>("button", {
        name: "common.cancel",
      });
      await user.pointer({ target: cancel, keys: "[MouseLeft>]" });
      view.rerender(
        <WallpaperImagineControls
          t={t}
          locked={false}
          model={{ ...active, generating: false }}
        />,
      );
      await user.pointer({ target: cancel, keys: "[/MouseLeft]" });
      expect(active.onGenerate).not.toHaveBeenCalled();
      expect(active.onCancelGeneration).not.toHaveBeenCalled();

      const generateName =
        mode === "image"
          ? "settings.wallpaperSource.generate"
          : mode === "edit"
            ? "settings.wallpaperSource.editImage"
            : "settings.wallpaperSource.generateVideo";
      await user.click(screen.getByRole("button", { name: generateName }));
      expect(active.onGenerate).toHaveBeenCalledOnce();
    },
  );

  it("does not generate when Space is released after a request finishes", async () => {
    const user = userEvent.setup();
    const active = model({ prompt: "A quiet lake", generating: true });
    const view = render(
      <WallpaperImagineControls t={t} locked model={active} />,
    );
    const cancel = screen.getByRole<HTMLButtonElement>("button", {
      name: "common.cancel",
    });
    cancel.focus();
    await user.keyboard("[Space>]");
    view.rerender(
      <WallpaperImagineControls
        t={t}
        locked={false}
        model={{ ...active, generating: false }}
      />,
    );
    await user.keyboard("[/Space]");
    expect(active.onGenerate).not.toHaveBeenCalled();
    expect(active.onCancelGeneration).not.toHaveBeenCalled();
  });

  it("blocks duplicate cancellation while both action targets stay mounted", async () => {
    const user = userEvent.setup();
    const active = model({ prompt: "A quiet lake", generating: true });
    const view = render(
      <WallpaperImagineControls t={t} locked model={active} />,
    );
    const cancel = screen.getByRole<HTMLButtonElement>("button", {
      name: "common.cancel",
    });

    await user.click(cancel);
    view.rerender(
      <WallpaperImagineControls
        t={t}
        locked
        model={{ ...active, cancelling: true }}
      />,
    );
    await user.click(cancel);
    await user.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.generate",
      }),
    );

    expect(active.onCancelGeneration).toHaveBeenCalledTimes(1);
    expect(active.onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "common.cancel" })).toBe(
      cancel,
    );
  });

  it("allows cancelling image generation while other controls are locked", () => {
    const onCancelGeneration = vi.fn();
    render(
      <WallpaperImagineControls
        t={t}
        locked
        model={model({
          mode: "image",
          generating: true,
          onCancelGeneration,
        })}
      />,
    );

    const action = screen.getByRole<HTMLButtonElement>("button", {
      name: "common.cancel",
    });
    expect(action.disabled).toBe(false);
    fireEvent.click(action);
    expect(onCancelGeneration).toHaveBeenCalledOnce();
  });
});
