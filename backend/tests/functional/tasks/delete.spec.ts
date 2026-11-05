import Task from '#models/task'
import User from '#models/user'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

/**
 * Borrar una tarea por la API: `DELETE /api/v1/tasks/:id`. La spec viva todavía
 * no tiene ningún requisito de borrado, así que estos tests citan la historia
 * `docs/backlog/E2-gestion-tareas/us-borrar-tarea.md` y sus criterios (CA-n).
 *
 * Solo cubre la parte de la API. La confirmación antes de borrar (CA-4 a CA-6)
 * es de interfaz y no pasa por aquí.
 */
test.group('Tasks | borrar', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /** Deja creada una cuenta con sesión y devuelve su token. */
  async function cuentaConToken(client: any, email: string) {
    await User.create({ fullName: 'Ada Lovelace', email, password: 'secreto123' })

    const login = await client.post('/api/v1/auth/login').json({ email, password: 'secreto123' })

    return login.body().data.token as string
  }

  /** Crea una tarea a nombre de la cuenta del token y devuelve su id. */
  async function tareaDe(client: any, token: string) {
    const creada = await client
      .post('/api/v1/tasks')
      .header('Authorization', `Bearer ${token}`)
      .json({ title: 'Revisar el informe' })

    creada.assertStatus(201)

    return creada.body().data.id as number
  }

  test('borrar una tarea responde 204 sin cuerpo y la tarea deja de existir', async ({
    client,
    assert,
  }) => {
    const token = await cuentaConToken(client, 'ada@example.com')
    const id = await tareaDe(client, token)

    const respuesta = await client
      .delete(`/api/v1/tasks/${id}`)
      .header('Authorization', `Bearer ${token}`)

    respuesta.assertStatus(204)
    assert.equal(respuesta.text(), '')
    assert.isNull(await Task.find(id))
  })

  test('CA-2: la tarea borrada desaparece también para otra cuenta', async ({ client, assert }) => {
    const token = await cuentaConToken(client, 'ada@example.com')
    const otroToken = await cuentaConToken(client, 'grace@example.com')
    const id = await tareaDe(client, token)

    await client.delete(`/api/v1/tasks/${id}`).header('Authorization', `Bearer ${token}`)

    const lista = await client.get('/api/v1/tasks').header('Authorization', `Bearer ${otroToken}`)

    lista.assertStatus(200)
    const tareas = lista.body().data as { id: number }[]
    assert.isUndefined(tareas.find((tarea) => tarea.id === id))
  })

  test('CA-3: se puede borrar una tarea ajena, sin permiso especial', async ({
    client,
    assert,
  }) => {
    const token = await cuentaConToken(client, 'ada@example.com')
    const otroToken = await cuentaConToken(client, 'grace@example.com')
    const id = await tareaDe(client, token)

    const respuesta = await client
      .delete(`/api/v1/tasks/${id}`)
      .header('Authorization', `Bearer ${otroToken}`)

    respuesta.assertStatus(204)
    assert.isNull(await Task.find(id))
  })

  test('borrar una tarea no toca las demás', async ({ client, assert }) => {
    const token = await cuentaConToken(client, 'ada@example.com')
    const id = await tareaDe(client, token)
    const otraId = await tareaDe(client, token)

    const respuesta = await client
      .delete(`/api/v1/tasks/${id}`)
      .header('Authorization', `Bearer ${token}`)

    respuesta.assertStatus(204)
    assert.isNotNull(await Task.find(otraId))
  })

  test('CA-10: sin sesión responde 401 y no se borra nada', async ({ client, assert }) => {
    const token = await cuentaConToken(client, 'ada@example.com')
    const id = await tareaDe(client, token)

    const respuesta = await client.delete(`/api/v1/tasks/${id}`)

    respuesta.assertStatus(401)
    assert.isNotNull(await Task.find(id))
  })

  test('CA-11: borrar dos veces responde 404 la segunda', async ({ client }) => {
    const token = await cuentaConToken(client, 'ada@example.com')
    const id = await tareaDe(client, token)

    const primera = await client
      .delete(`/api/v1/tasks/${id}`)
      .header('Authorization', `Bearer ${token}`)

    primera.assertStatus(204)

    const segunda = await client
      .delete(`/api/v1/tasks/${id}`)
      .header('Authorization', `Bearer ${token}`)

    segunda.assertStatus(404)
  })

  test('un identificador que no es un número responde 404, no 500', async ({ client }) => {
    const token = await cuentaConToken(client, 'ada@example.com')

    const respuesta = await client
      .delete('/api/v1/tasks/no-es-un-numero')
      .header('Authorization', `Bearer ${token}`)

    respuesta.assertStatus(404)
  })

  /**
   * SQLite convierte a número el texto que se compara con una columna entera,
   * así que sin filtrar en la ruta estas URLs casarían con la tarea. Borrar es
   * irreversible: solo vale el identificador tal y como lo devuelve la API.
   */
  test('un identificador que solo se parece al de una tarea responde 404 y no la borra', async ({
    client,
    assert,
  }) => {
    const token = await cuentaConToken(client, 'ada@example.com')
    const id = await tareaDe(client, token)

    for (const parecido of [`${id}.0`, `${id}e0`, `+${id}`, `%20${id}`, `0${id}`]) {
      const respuesta = await client
        .delete(`/api/v1/tasks/${parecido}`)
        .header('Authorization', `Bearer ${token}`)

      assert.equal(respuesta.status(), 404, parecido)
      assert.isNotNull(await Task.find(id), parecido)
    }
  })
})
