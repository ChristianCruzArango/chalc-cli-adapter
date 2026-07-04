# Plan: listar cliente
> Fase **Plan** — el CÓMO. Deriva de `spec.md`. Pide aprobación antes de generar tareas.
> Todavía **no** se escribe código.

## Enfoque técnico
El enfoque técnico consiste en crear un componente de listado de clientes que muestre la información solicitada (nit, nombre de empresa, contacto, teléfono y correo). Se implementará una validación del formato de correo electrónico para garantizar que solo se acepten correos válidos. Para esto, se creará un servicio de datos que simule la obtención de la lista de clientes y un validador de correo.

## Arquitectura / Componentes
- `src/app/models/cliente.model.ts` — Define el modelo de datos del cliente con los campos requeridos.
- `src/app/services/cliente.service.ts` — Servicio que proporciona los datos de los clientes (simulando una llamada a una API).
- `src/app/components/cliente-listado/cliente-listado.component.ts` — Componente de Angular que muestra la lista de clientes.
- `src/app/utils/email.validator.ts` — Validador de correo electrónico para verificar el formato del correo.

## Modelo de datos
| Entidad   | Campos             | Notas                               |
|-----------|--------------------|-------------------------------------|
| Cliente   | nit                | Identificador único del cliente     |
|           | nombreEmpresa      | Nombre de la empresa del cliente    |
|           | contacto           | Persona de contacto del cliente     |
|           | telefono           | Número de teléfono del cliente      |
|           | correo             | Dirección de correo electrónico del cliente (validación de formato) |

## Contratos / Interfaces
- `getListaClientes(): Observable<Cliente[]>` — Método del servicio que devuelve una lista observable de clientes.
