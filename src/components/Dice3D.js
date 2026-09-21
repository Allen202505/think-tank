'use client';

import styles from './Dice3D.module.css';

const FACES = [1, 2, 3, 4, 5, 6];

export default function Dice3D({ size = 18, spinning = false, className = '' }) {
  return (
    <span
      className={`${styles.wrap} ${className}`}
      style={{ '--dice-size': `${size}px` }}
      aria-hidden="true"
    >
      <span className={`${styles.die} ${spinning ? styles.spinning : ''}`}>
        {FACES.map((face) => (
          <span className={styles.face} data-face={face} key={face}>
            {Array.from({ length: 9 }).map((_, index) => <i className={styles.pip} key={index} />)}
          </span>
        ))}
      </span>
    </span>
  );
}
