import type { CSSProperties, PropsWithChildren } from 'react';

interface CardProps extends PropsWithChildren {
  className?: string;
  style?: CSSProperties;
}

export const Card = ({ className, style, children }: CardProps) => {
  return (
    <section className={`card ${className ?? ''}`.trim()} style={style}>
      {children}
    </section>
  );
};
