import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'light'
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
}
export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`button button--${variant} ${className}`}
      {...props}
    />
  )
}
export function ButtonLink({
  to,
  children,
  variant = 'primary',
  className = '',
}: {
  to: string
  children: ReactNode
  variant?: Variant
  className?: string
}) {
  return (
    <Link to={to} className={`button button--${variant} ${className}`}>
      {children}
    </Link>
  )
}
