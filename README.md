# NEXUS LEAGUE — Street Fighter 6

Sitio online para liga individual al mejor de cinco (BO5). Inscripción abierta, email y contraseña, tabla de posiciones, calendario, carga de resultados y confirmación por el rival.

## 1. Crear base de datos
1. Crear proyecto en https://supabase.com.
2. Abrir **SQL Editor**, pegar y ejecutar `supabase/schema.sql`.
3. En **Authentication > Providers > Email** habilitar email/password. Configurar la URL del sitio y URL de redirección del dominio final. Para producción, configurar SMTP propio para los correos de confirmación.
4. En **Project Settings / API** obtener **Project URL** y la **publishable key** (o anon key). Nunca usar `service_role` en el navegador.

## 2. Iniciar localmente
```bash
npm install
cp .env.example .env
# Editar .env con los datos del proyecto
npm run dev
```
Abrir la URL indicada por Vite.

## 3. Nombrar administrador
Primero crear una cuenta desde la web y completar su inscripción. Luego ejecutar en SQL Editor (reemplazar el correo):
```sql
insert into public.admins(id)
select id from auth.users where email='TU_CORREO@EJEMPLO.COM'
on conflict do nothing;
```
Al volver a ingresar, el administrador puede generar el calendario. **Inscribir a todos antes de generarlo:** esta primera versión crea una única temporada y no agrega participantes nuevos al calendario ya generado.

## 4. Publicar en Vercel
1. Subir esta carpeta a un repositorio GitHub privado o público.
2. Importar el repositorio en https://vercel.com/new.
3. Framework: **Vite**. Build command `npm run build`; output `dist`.
4. En Environment Variables agregar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
5. Desplegar y configurar la URL publicada en Supabase Auth > URL Configuration.

## Reglas y limitaciones
- Una serie se gana con 3 juegos. Resultados válidos: 3-0, 3-1, 3-2 (en ambos sentidos).
- Solo los dos participantes pueden reportar; solo el rival de quien reportó puede confirmar. Los resultados confirmados son definitivos en esta versión.
- 3 puntos por victoria, 0 por derrota; desempates por diferencia de juegos, juegos ganados y nombre.
- El calendario es todos contra todos a una sola vuelta, generado una vez por un administrador. El número de fecha es organizativo y **no** es todavía un calendario round-robin equilibrado por jornadas.
- No incluye recuperación de disputas, capturas de evidencia, varias temporadas ni edición de resultados confirmados. La inscripción permanece abierta, pero nuevos inscriptos después de generar el calendario no obtienen partidas automáticamente.
- Las contraseñas se gestionan en Supabase Auth; no se almacenan en la tabla de perfiles.
- Esta entrega contiene el código para conectar y publicar, **no un sitio ya alojado ni un proyecto Supabase creado**.
