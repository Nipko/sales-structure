# El canario de certificación: preparado, con precio, sin ejecutar

Antes de pedir autorización para la matriz completa —78.120 casos y entre
US$258,80 y US$5.466,20 según el modelo— hay una pregunta más barata: **¿el
ejecutor, el ledger, la guarda de presupuesto y el verificador sobreviven al
contacto con un proveedor real?**

Un perfil, un canal, los cuatro idiomas. Eso es el canario.

```bash
node apps/api/scripts/plan-certification-canary.cjs
```

## Lo que cuesta, calculado y no estimado

Salida del planificador, no de este documento:

```
CERTIFICATION CANARY — planned, not executed
  profile   salud/medica_general
  languages en, es, fr, pt
  channel   web_widget
  model     gpt-4o-mini   k=1
  bound     8000 in / 1000 out per turn

  cases         204
  model calls   408
  cost ceiling  US$0.76
  wall clock    41 min at 6s per turn
  plan hash     62bc39a4ab1939fd6a12981b8bbb8af8ed9c2e128e1d9146c5490c32580186f8
```

**US$0,76** contra US$258,80 de la matriz completa con el mismo modelo: el
canario cuesta el 0,3% y contesta la única pregunta que hace falta contestar
primero.

Los números salen de `planCertificationRun` y del catálogo del propio router, el
mismo que usa `generate-certification-manifest.cjs` para la matriz completa. La
cifra que se autoriza y la que se factura no pueden ser dos listas de precios
distintas. El techo redondea hacia arriba desde un límite declarado de 8.000
tokens de entrada y 1.000 de salida por turno: un presupuesto que redondea hacia
abajo es un presupuesto que se pasa.

## Por qué ese perfil y ese canal

- **`salud/medica_general`**: es canónico y tiene las tres cosas cuyo fallo bajo
  un modelo real importaría más — motor de reservas, camino de dinero y
  escalada a humano. Un perfil que el catálogo no conoce se **rechaza** en vez de
  planificarse: el plan y la corrida comparten
  `listCanonicalSubtypeExperienceProfileIds`.
- **`web_widget`**: es el único canal sin cuenta de proveedor delante. El canario
  puede correr sin esperar a que se aprueben cuentas de prueba de WhatsApp,
  Instagram, Messenger o Telegram — que es otro gate externo, distinto de éste.
- **Los cuatro idiomas, siempre.** La certificación los exige todos y el
  planificador rechaza un alcance al que le falte uno, en vez de certificar tres
  cuartos de algo. Un canario que dejara un idioma afuera estaría ensayando una
  corrida que no puede ocurrir.
- **`gpt-4o-mini`** por ser el más barato del catálogo certificable. Cambiarlo es
  `--model`, y el precio se recalcula solo.

## Lo que este canario contestaría

No es una certificación y no debe leerse como una. Lo que dice, si sale verde:

1. el ejecutor durable arrienda, escribe el resultado una sola vez y trata un
   reintento como intento nuevo, **contra un proveedor real y no contra un doble**;
2. la guarda de presupuesto descuenta antes de entregar trabajo, y el techo
   declarado se parece al gasto real;
3. el verificador de resultados distingue un efecto ocurrido de uno afirmado;
4. la matriz completa cuesta lo que el manifiesto dice que cuesta, porque un
   perfil ya se midió.

Y si sale rojo, cuesta US$0,76 averiguarlo en vez de US$258,80.

## Lo que falta para correrlo (gate externo 2)

Ninguna de estas es código:

- una credencial del proveedor del modelo elegido (`OPENAI_API_KEY` para el
  default; el manifiesto nombra la de cada modelo);
- un techo de gasto autorizado por el dueño;
- la autorización explícita de ejecución.

**Este script no ejecuta nada.** No abre conexión, no lee credencial y no tiene
cliente de proveedor: sólo planifica e imprime. Correr el canario es
`certification.service`, detrás del mismo gate que la matriz completa.

## Una corrección de vocabulario que conviene sostener

No hay «el costo de certificar». Hay un costo **por modelo**, y del más barato al
más caro hay un factor de 21×. Cualquier cifra sin el nombre del modelo al lado
es una cifra que se va a citar mal.
