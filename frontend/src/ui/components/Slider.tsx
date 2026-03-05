import type { InputHTMLAttributes } from 'react';

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> {
  label: string;
  value: number;
  valueLabel?: string;
}

export const Slider = ({ label, valueLabel, className, ...rest }: SliderProps) => {
  const safeValue = Number.isFinite(rest.value) ? rest.value : 0;

  return (
    <label className={`slider-row ${className ?? ''}`.trim()}>
      <div className="slider-header">
        <span>{label}</span>
        {valueLabel ? <span>{valueLabel}</span> : null}
      </div>
      <input className="slider-input" type="range" {...rest} value={safeValue} />
    </label>
  );
};
