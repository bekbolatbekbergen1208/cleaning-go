'use client';
import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Icon } from './icon';

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className="input"
      />
      <button
        type="button"
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        <Icon name="eye" width="20" height="20" />
      </button>
    </div>
  );
}
