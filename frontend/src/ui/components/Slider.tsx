import type { InputHTMLAttributes } from 'react';

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  valueLabel?: string;
}

export const Slider = ({ label, valueLabel, className, ...rest }: SliderProps) => {
  return (
    <label className={`slider-row ${className ?? ''}`.trim()}>
      <div className="slider-header">
        <span>{label}</span>
        {valueLabel ? <span>{valueLabel}</span> : null}
      </div>
      <input className="slider-input" type="range" {...rest} />
    </label>
  );
};
