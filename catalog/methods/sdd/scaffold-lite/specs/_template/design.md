# Diseño: <feature>

> Solo si el plan declara `Superficie: ui`. La composición de cada pantalla se decide AQUÍ y se aprueba con la
> spec, antes de programar. Los números (separaciones, tamaños, contraste) no se repiten: salen del contrato,
> `.chalc/design.contract.json`. Si esta spec necesita otros, van en `design.contract.json` de esta carpeta.

## Pantalla: <nombre> (cubre R?)
- **Propósito:** <qué viene a hacer el usuario aquí, en una frase>
- **Primario:** <la única acción principal de la vista>
- **Secundarias:** <las demás acciones, en orden de importancia>
- **Composición:** <qué bloques hay y en qué orden, de arriba abajo; qué va junto y qué va separado>
- **Estados:** vacío · cargando · con datos · error · sin permiso — <qué se ve en cada uno>
- **En pantalla estrecha:** <qué se apila, qué se oculta, qué pasa con las tablas>

## Componentes existentes que se reutilizan
- `<ruta/al/componente>` — <para qué>

## Dudas abiertas
- [NEEDS CLARIFICATION: ...]
