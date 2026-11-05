import Task, { TASK_STATUSES } from '#models/task'
import User from '#models/user'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'

/**
 * Borrar una tarea: `DELETE /api/v1/tasks/:id`.
 *
 * La spec viva (`openspec/specs/tasks/spec.md`) no tiene todavía ningún
 * requisito de borrado —el ADR 0001 lo anota: el backlog contiene «borrar una
 * tarea» y la spec no—, así que aquí no hay requisito que citar. Lo que se
 * comprueba sale de RF-12 del PRD (`docs/prd/flowsync-mvp.md`) y de los
 * criterios CA-1, CA-2, CA-3, CA-10 y CA-11 de
 * `docs/backlog/E2-gestion-tareas/us-borrar-tarea.md`.
 *
 * Esto cubre solo el endpoint. La confirmación explícita que pide RF-12
 * (CA-4 a CA-7) es de interfaz y no está en este test ni en este cambio.
 *
 * La suite pega contra el mismo SQLite que el servidor de desarrollo, y la
 * transacción global aísla lo que estos tests escriben, no lo que ya hubiera.
 * Por eso las cuentas llevan emails propios de este fichero (el recorrido
 * manual del README de la capability registra `ada@example.com`) y ninguna
 * comprobación supone que no haya otras filas en la tabla.
 */
test.group('Tasks | borrar', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /** Una cuenta ya registrada y con sesión: su modelo y el token con el que actúa. */
  async function cuenta(client: ApiClient, email: string) {
    const user = await User.create({ fullName: null, email, password: 'secreto123' })

    const login = await client.post('/api/v1/auth/login').json({ email, password: 'secreto123' })
    login.assertStatus(200)

    return { user, token: login.body().data.token as string }
  }

  /**
   * Una tarea a nombre de `user`, creada sin pasar por la API: aquí es solo el
   * punto de partida, lo que se prueba es lo que le ocurre al borrarla.
   */
  function tareaDe(user: User, title = 'Revisar el informe') {
    return Task.create({ title, status: 'pending', assigneeId: user.id })
  }

  /** Los ids que ve en la lista quien lleva ese token. */
  async function idsEnLaLista(client: ApiClient, token: string) {
    const lista = await client.get('/api/v1/tasks').header('Authorization', `Bearer ${token}`)
    lista.assertStatus(200)

    return (lista.body().data as { id: number }[]).map((tarea) => tarea.id)
  }

  test('borrar una tarea responde 204 sin cuerpo y la tarea deja de existir', async ({
    client,
    assert,
  }) => {
    const { user, token } = await cuenta(client, 'ada.borrar@example.com')
    const tarea = await tareaDe(user)

    const respuesta = await client
      .delete(`/api/v1/tasks/${tarea.id}`)
      .header('Authorization', `Bearer ${token}`)

    respuesta.assertStatus(204)
    // Sin cuerpo de verdad: ni `{ "data": ... }` ni un objeto vacío. El
    // serializer envuelve todo lo que pasa por `serialize()`, y un 204 no debe
    // pasar por ahí.
    assert.equal(respuesta.text(), '')
    assert.isNull(await Task.find(tarea.id))
  })

  test('la tarea borrada desaparece de la lista para el resto del equipo', async ({
    client,
    assert,
  }) => {
    const ada = await cuenta(client, 'ada.borrar@example.com')
    const grace = await cuenta(client, 'grace.borrar@example.com')
    const tarea = await tareaDe(ada.user)

    // Antes de borrar, la otra persona la ve. Sin esta comprobación el test
    // pasaría igual contra una lista que nunca la hubiera enseñado.
    assert.include(await idsEnLaLista(client, grace.token), tarea.id)

    const respuesta = await client
      .delete(`/api/v1/tasks/${tarea.id}`)
      .header('Authorization', `Bearer ${ada.token}`)
    respuesta.assertStatus(204)

    assert.notInclude(await idsEnLaLista(client, grace.token), tarea.id)
    assert.notInclude(await idsEnLaLista(client, ada.token), tarea.id)

    // Y abrirla, que es lo que haría quien la tuviera a la vista, ya no la
    // encuentra: no queda ninguna forma de llegar a ella.
    const abierta = await client
      .get(`/api/v1/tasks/${tarea.id}`)
      .qs({ today: '2026-08-20' })
      .header('Authorization', `Bearer ${grace.token}`)
    abierta.assertStatus(404)
  })

  test('se puede borrar una tarea que lleva otra persona, sin ningún permiso especial', async ({
    client,
    assert,
  }) => {
    const ada = await cuenta(client, 'ada.borrar@example.com')
    const grace = await cuenta(client, 'grace.borrar@example.com')
    const deAda = await tareaDe(ada.user)

    const respuesta = await client
      .delete(`/api/v1/tasks/${deAda.id}`)
      .header('Authorization', `Bearer ${grace.token}`)

    respuesta.assertStatus(204)
    assert.isNull(await Task.find(deAda.id))
  })

  test('borrar una tarea no toca las demás', async ({ client, assert }) => {
    const { user, token } = await cuenta(client, 'ada.borrar@example.com')
    const borrada = await tareaDe(user, 'La que se borra')
    const primera = await tareaDe(user, 'Se queda la primera')
    const segunda = await tareaDe(user, 'Se queda la segunda')

    // La BD de desarrollo puede tener ya otras tareas: se cuentan todas antes y
    // después, en vez de suponer que estas tres son las únicas.
    const todasAntes = await Task.all()

    const respuesta = await client
      .delete(`/api/v1/tasks/${borrada.id}`)
      .header('Authorization', `Bearer ${token}`)
    respuesta.assertStatus(204)

    // Exactamente una menos, y las otras dos en su sitio y sin tocar: un borrado
    // sin `where` dejaría el recuento a cero, y uno que se llevase de más se
    // notaría aquí y no solo en que «la borrada ya no está».
    const todasDespues = await Task.all()
    assert.equal(todasDespues.length, todasAntes.length - 1)
    assert.isNull(await Task.find(borrada.id))

    const intacta = await Task.findOrFail(primera.id)
    assert.equal(intacta.title, 'Se queda la primera')
    assert.isNotNull(await Task.find(segunda.id))
  })

  test('se puede borrar una tarea en cualquier estado, con o sin fecha de vencimiento', async ({
    client,
    assert,
  }) => {
    const { user, token } = await cuenta(client, 'ada.borrar@example.com')

    // Las hechas son justo las que la lista por defecto esconde, y una con fecha
    // es la que trae su vencimiento al abrirla: un borrado que mirase el estado
    // o la fecha pasaría todos los demás tests, que usan siempre una pendiente
    // y sin fecha.
    for (const status of TASK_STATUSES) {
      for (const dueDate of [null, '2026-08-19']) {
        const tarea = await Task.create({
          title: 'Para borrar',
          status,
          dueDate,
          assigneeId: user.id,
        })

        const respuesta = await client
          .delete(`/api/v1/tasks/${tarea.id}`)
          .header('Authorization', `Bearer ${token}`)

        respuesta.assertStatus(204)
        assert.isNull(await Task.find(tarea.id), `${status}, vencimiento ${dueDate}`)
      }
    }
  })

  test('sin sesión responde 401 y la tarea sigue donde estaba', async ({ client, assert }) => {
    const { user } = await cuenta(client, 'ada.borrar@example.com')
    const tarea = await tareaDe(user)

    const sinCabecera = await client.delete(`/api/v1/tasks/${tarea.id}`)
    sinCabecera.assertStatus(401)
    assert.isNotNull(await Task.find(tarea.id))

    const conTokenInventado = await client
      .delete(`/api/v1/tasks/${tarea.id}`)
      .header('Authorization', 'Bearer inventado')
    conTokenInventado.assertStatus(401)
    assert.isNotNull(await Task.find(tarea.id))
  })

  test('borrar dos veces la misma tarea: la segunda responde 404, no un fallo del sistema', async ({
    client,
  }) => {
    const ada = await cuenta(client, 'ada.borrar@example.com')
    const grace = await cuenta(client, 'grace.borrar@example.com')
    const tarea = await tareaDe(ada.user)

    // Es el caso corriente de dos personas con la misma tarea a la vista: una
    // la borra y la otra, un instante después, intenta lo mismo.
    const primera = await client
      .delete(`/api/v1/tasks/${tarea.id}`)
      .header('Authorization', `Bearer ${ada.token}`)
    primera.assertStatus(204)

    const segunda = await client
      .delete(`/api/v1/tasks/${tarea.id}`)
      .header('Authorization', `Bearer ${grace.token}`)
    // Un 404 y no un 5xx: «ya no existe» es una respuesta corriente, no un
    // fallo. Del cuerpo no se afirma nada: en desarrollo es el volcado de
    // depuración de AdonisJS, y no es parte de lo que se quiere fijar aquí.
    segunda.assertStatus(404)
  })

  test('un id que no es de ninguna tarea responde 404 y no borra nada', async ({
    client,
    assert,
  }) => {
    const { user, token } = await cuenta(client, 'ada.borrar@example.com')
    const tarea = await tareaDe(user)

    // Un número que no existe, algo que no es un número y un intento de colar
    // una condición: ninguno es una tarea, ninguno puede acabar en un 500 ni en
    // un borrado.
    for (const id of ['999999', 'abc', '0', '-1', '1%20OR%201%3D1']) {
      const respuesta = await client
        .delete(`/api/v1/tasks/${id}`)
        .header('Authorization', `Bearer ${token}`)

      respuesta.assertStatus(404)
    }

    assert.isNotNull(await Task.find(tarea.id))

    // Control: el mismo endpoint, con el id de verdad, sí borra. Sin esto, un
    // 404 de «esa ruta no existe» se confundiría con el de «esa tarea no existe»
    // y el test pasaría igual sin el endpoint.
    const control = await client
      .delete(`/api/v1/tasks/${tarea.id}`)
      .header('Authorization', `Bearer ${token}`)

    control.assertStatus(204)
  })
})
