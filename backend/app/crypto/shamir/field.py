from collections.abc import Sequence

# Primo conocido; admite cualquier secreto AES de 256 bits sin reducirlo.
PRIME = (1 << 521) - 1


def evaluate_polynomial(coefficients: Sequence[int], x: int) -> int:
    """Evalúa un polinomio con Horner en el campo GF(PRIME)."""
    result = 0
    for coefficient in reversed(coefficients):
        result = (result * x + coefficient) % PRIME
    return result


def interpolate_at(points: Sequence[tuple[int, int]], x: int) -> int:
    """Interpola puntos con índices distintos; el llamador los valida."""
    result = 0
    for i, (xi, yi) in enumerate(points):
        numerator = 1
        denominator = 1
        for j, (xj, _) in enumerate(points):
            if i != j:
                numerator = numerator * (x - xj) % PRIME
                denominator = denominator * (xi - xj) % PRIME
        result = (result + yi * numerator * pow(denominator, -1, PRIME)) % PRIME
    return result
