import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  LabSettings,
  type LabSettingsProps,
  type LabSettingsValue,
} from "./LabSettings";

const initialValue: LabSettingsValue = {
  runSeed: 42,
  populationSize: 256,
  episodesPerGenome: 8,
  mutationProbability: 0.12,
  mutationStandardDeviation: 0.18,
  automaticCurriculum: true,
  manualLevel: 3,
  reducedEffects: false,
};

function props(overrides: Partial<LabSettingsProps> = {}): LabSettingsProps {
  return {
    open: true,
    value: initialValue,
    onApply: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("LabSettings", () => {
  it("keeps edits in a draft and discards them on cancel", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <LabSettings {...props({ onApply, onClose })} />,
    );

    const seed = screen.getByRole("spinbutton", { name: "Run seed" });
    await user.clear(seed);
    await user.type(seed, "99");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();

    rerender(<LabSettings {...props({ open: false, onApply, onClose })} />);
    rerender(<LabSettings {...props({ onApply, onClose })} />);
    expect(screen.getByRole("spinbutton", { name: "Run seed" })).toHaveValue(42);
  });

  it("applies the complete edited settings payload", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<LabSettings {...props({ onApply })} />);

    const seed = screen.getByRole("spinbutton", { name: "Run seed" });
    await user.clear(seed);
    await user.type(seed, "1234");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Population" }),
      "128",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Episodes" }),
      "4",
    );
    fireEvent.change(
      screen.getByRole("slider", { name: "Mutation probability" }),
      { target: { value: "0.35" } },
    );
    fireEvent.change(
      screen.getByRole("slider", { name: "Mutation deviation" }),
      { target: { value: "0.27" } },
    );
    await user.click(
      screen.getByRole("switch", { name: "Automatic curriculum" }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Manual level" }),
      "5",
    );
    await user.click(screen.getByRole("switch", { name: "Reduced effects" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith({
      runSeed: 1234,
      populationSize: 128,
      episodesPerGenome: 4,
      mutationProbability: 0.35,
      mutationStandardDeviation: 0.27,
      automaticCurriculum: false,
      manualLevel: 5,
      reducedEffects: true,
    });
    expect(screen.getByText("0.35", { selector: "output" })).toBeInTheDocument();
    expect(screen.getByText("0.27", { selector: "output" })).toBeInTheDocument();
  });

  it("enables manual level only when automatic curriculum is off", async () => {
    const user = userEvent.setup();
    render(<LabSettings {...props()} />);

    const automatic = screen.getByRole("switch", {
      name: "Automatic curriculum",
    });
    const manualLevel = screen.getByRole("combobox", { name: "Manual level" });
    expect(manualLevel).toBeDisabled();

    await user.click(automatic);
    expect(manualLevel).toBeEnabled();

    await user.click(automatic);
    expect(manualLevel).toBeDisabled();
  });

  it("focuses close first and closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LabSettings {...props({ onClose })} />);

    const close = screen.getByRole("button", { name: "Close settings" });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
