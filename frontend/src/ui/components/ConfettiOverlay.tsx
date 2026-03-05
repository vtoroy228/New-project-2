import { useMemo } from 'react';

interface ConfettiOverlayProps {
  visible: boolean;
}

interface Piece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  rotate: number;
}

const PIECES_COUNT = 22;

export const ConfettiOverlay = ({ visible }: ConfettiOverlayProps) => {
  const pieces = useMemo<Piece[]>(() => {
    return Array.from({ length: PIECES_COUNT }, (_, index) => ({
      id: index,
      left: Math.random() * 100,
      delay: Math.random() * 0.15,
      duration: 1.2 + Math.random() * 1.4,
      rotate: Math.floor(Math.random() * 160 - 80)
    }));
  }, [visible]);

  if (!visible) {
    return null;
  }

  return (
    <div className="confetti-layer" aria-hidden>
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="confetti-piece"
          style={{
            left: `${piece.left}%`,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            transform: `rotate(${piece.rotate}deg)`
          }}
        />
      ))}
    </div>
  );
};
