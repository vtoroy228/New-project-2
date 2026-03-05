interface ToggleProps {
  checked: boolean;
  label: string;
  onChange: (nextValue: boolean) => void;
}

export const Toggle = ({ checked, label, onChange }: ToggleProps) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="toggle-row"
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className={`toggle-knob ${checked ? 'toggle-knob-on' : ''}`} aria-hidden />
    </button>
  );
};
