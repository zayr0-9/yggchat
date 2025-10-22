/**
 * Money/Credit Precision Utilities
 *
 * Uses decimal.js for exact decimal arithmetic to avoid floating-point precision errors
 * in financial calculations. All credit/cost operations should use these utilities.
 */

import Decimal from 'decimal.js'

// Configure Decimal.js for financial precision
// Use 8 decimal places for internal calculations, round to 6 for storage
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP })

/**
 * Number of decimal places to use for credit/money values
 * OpenRouter uses up to 6 decimal places, we'll match that
 */
export const MONEY_DECIMAL_PLACES = 6

/**
 * Add two money values with exact precision
 */
export function moneyAdd(a: number | string, b: number | string): number {
  return new Decimal(a).plus(new Decimal(b)).toDecimalPlaces(MONEY_DECIMAL_PLACES).toNumber()
}

/**
 * Subtract two money values with exact precision
 */
export function moneySubtract(a: number | string, b: number | string): number {
  return new Decimal(a).minus(new Decimal(b)).toDecimalPlaces(MONEY_DECIMAL_PLACES).toNumber()
}

/**
 * Multiply money value with exact precision
 */
export function moneyMultiply(a: number | string, b: number | string): number {
  return new Decimal(a).times(new Decimal(b)).toDecimalPlaces(MONEY_DECIMAL_PLACES).toNumber()
}

/**
 * Divide money value with exact precision
 */
export function moneyDivide(a: number | string, b: number | string): number {
  return new Decimal(a).dividedBy(new Decimal(b)).toDecimalPlaces(MONEY_DECIMAL_PLACES).toNumber()
}

/**
 * Round a money value to standard precision
 */
export function moneyRound(value: number | string): number {
  return new Decimal(value).toDecimalPlaces(MONEY_DECIMAL_PLACES).toNumber()
}

/**
 * Format money value for display
 */
export function moneyFormat(value: number | string, decimalPlaces: number = MONEY_DECIMAL_PLACES): string {
  return new Decimal(value).toFixed(decimalPlaces)
}

/**
 * Compare two money values (returns -1, 0, or 1)
 */
export function moneyCompare(a: number | string, b: number | string): number {
  return new Decimal(a).comparedTo(new Decimal(b))
}

/**
 * Check if two money values are equal (within precision)
 */
export function moneyEquals(a: number | string, b: number | string): boolean {
  return new Decimal(a).equals(new Decimal(b))
}

/**
 * Get absolute value of money
 */
export function moneyAbs(value: number | string): number {
  return new Decimal(value).abs().toDecimalPlaces(MONEY_DECIMAL_PLACES).toNumber()
}

/**
 * Check if money value is zero (within precision threshold)
 */
export function moneyIsZero(value: number | string, threshold: number = 0.000001): boolean {
  return new Decimal(value).abs().lessThan(threshold)
}

/**
 * Get the maximum of two money values
 */
export function moneyMax(a: number | string, b: number | string): number {
  return Decimal.max(a, b).toDecimalPlaces(MONEY_DECIMAL_PLACES).toNumber()
}

/**
 * Get the minimum of two money values
 */
export function moneyMin(a: number | string, b: number | string): number {
  return Decimal.min(a, b).toDecimalPlaces(MONEY_DECIMAL_PLACES).toNumber()
}

/**
 * Sum an array of money values
 */
export function moneySum(values: (number | string)[]): number {
  return values
    .reduce((sum, val) => sum.plus(new Decimal(val)), new Decimal(0))
    .toDecimalPlaces(MONEY_DECIMAL_PLACES)
    .toNumber()
}
