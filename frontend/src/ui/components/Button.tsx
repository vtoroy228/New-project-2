import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

type Variant = 'primary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, PropsWithChildren {
  variant?: Variant;
  fullWidth?: boolean;
}

export const Button = ({ variant = 'primary', fullWidth, className, children, ...rest }: ButtonProps) => {
  return (
    <button
      type="button"
      className={`button button-${variant} ${fullWidth ? 'button-full' : ''} ${className ?? ''}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
};
