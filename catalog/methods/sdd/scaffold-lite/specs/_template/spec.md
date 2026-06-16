# Spec: <nombre de la feature>

> Fase **Specify** — el QUÉ y el PORQUÉ. Sin detalles de implementación.
> Marca lo dudoso con `[NEEDS CLARIFICATION: ...]` y resuélvelo antes de planear.

## Contexto / Problema
<qué problema resolvemos y por qué importa>

## Objetivo
<resultado esperado, en una frase>

## Historias de usuario
- Como <rol> quiero <acción> para <beneficio>.

## Requisitos (criterios de aceptación, notación EARS)
Cada requisito tiene id y debe poder convertirse en un test.

- **R1** — WHEN <condición/evento> THE SYSTEM SHALL <comportamiento esperado>.
- **R2** — IF <condición no deseada> THEN THE SYSTEM SHALL <respuesta>.
- **R3** — WHILE <estado> THE SYSTEM SHALL <comportamiento>.
- **R4** — WHERE <feature presente> THE SYSTEM SHALL <comportamiento>.

_Ejemplo:_ **R1** — WHEN un usuario envía el formulario con datos inválidos THE SYSTEM SHALL mostrar el error de validación junto al campo correspondiente.

## Fuera de alcance
- <lo que NO entra en esta feature>

## Dudas abiertas
- [NEEDS CLARIFICATION: ...]
