# Especificación de la Feature: Listar Cliente

## Contexto

La necesidad de listar clientes con sus datos completos es fundamental para el sistema, permitiendo a los usuarios consultar información de contacto y detalles relevantes de cada cliente. Esta funcionalidad facilita la gestión de la base de datos de clientes y mejora la experiencia del usuario al proporcionar acceso rápido a los datos requeridos.

## Objetivo

Implementar una funcionalidad que permita mostrar una lista de clientes con sus respectivos datos (nit, nombre de empresa, contacto, teléfono y correo), incluyendo validación adecuada del campo de correo electrónico.

## Historia de usuario

**Como** usuario quiero listar clientes para consultar sus datos de contacto

## Requisitos en notación EARS

R1: WHEN se solicita la lista THE SYSTEM SHALL mostrar cada cliente con nit, nombre de empresa, contacto, teléfono y correo.

R2: WHEN se ingresa/valida un correo THE SYSTEM SHALL aceptarlo solo si cumple formato de email válido.

R3: IF el correo tiene formato inválido THEN THE SYSTEM SHALL mostrar el error junto al campo.

## Fuera de alcance

- Creación o edición de clientes (solo listado)
- Autenticación y autorización de usuarios
- Exportación de datos a formatos externos

## Dudas abiertas

- ¿Qué tipo de formato de correo electrónico se considera válido? (ej: solo dominios comunes o cualquier formato estándar?)
- ¿Se requiere algún tipo de paginación o límite en la cantidad de clientes mostrados?
