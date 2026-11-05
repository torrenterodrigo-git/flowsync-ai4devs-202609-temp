import Task from '#models/task'
import User from '#models/user'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

/**
 * `DELETE /api/v1/tasks/:id`. Todavía no hay requisito en
 * `openspec/specs/tasks/spec.md`: estos tests salen de RF-12 del PRD y de los
 * criterios CA-1, CA-3, CA-10 y CA-11 de la historia E2-10.
 */
test.group('Tasks | borrar', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function cuenta(client: any, email: string) {
    await User.create({ fullName: 'Ada Lovelace', email, password: 'secreto123' })

    const login = await client.post('/api/v1/auth/login').json({ email, password: 'secreto123' })
    return login.body().data.token as string
  }

  async function tareaDe(email: string) {
    const user = await User.findByOrFail('email', email)
    return Task.create({ title: 'Revisar el informe', status: 'pending', assigneeId: user.id })
  }

  test('borra la tarea y responde 204 sin cuerpo', async ({ client, assert }) => {
    const token = await cuenta(client, 'ada@example.com')
    const tarea = await tareaDe('ada@example.com')

    const respuesta = await client
      .delete(`/api/v1/tasks/${tarea.id}`)
      .header('Authorization', `Bearer ${token}`)

    respuesta.assertStatus(204)
    assert.equal(respuesta.text(), '')
    assert.isNull(await Task.find(tarea.id))

    const lista = await client.get('/api/v1/tasks').header('Authorization', `Bearer ${token}`)
    const ids = (lista.body().data as { id: number }[]).map((t) => t.id)
    assert.notInclude(ids, tarea.id)
  })

  test('cualquier cuenta con sesión puede borrar una tarea ajena', async ({ client, assert }) => {
    await cuenta(client, 'ada@example.com')
    const ajena = await tareaDe('ada@example.com')
    const token = await cuenta(client, 'grace@example.com')

    const respuesta = await client
      .delete(`/api/v1/tasks/${ajena.id}`)
      .header('Authorization', `Bearer ${token}`)

    respuesta.assertStatus(204)
    assert.isNull(await Task.find(ajena.id))
  })

  test('sin sesión responde 401 y no borra nada', async ({ client, assert }) => {
    await cuenta(client, 'ada@example.com')
    const tarea = await tareaDe('ada@example.com')

    const respuesta = await client.delete(`/api/v1/tasks/${tarea.id}`)

    respuesta.assertStatus(401)
    assert.isNotNull(await Task.find(tarea.id))
  })

  test('borrarla por segunda vez responde 404', async ({ client }) => {
    const token = await cuenta(client, 'ada@example.com')
    const tarea = await tareaDe('ada@example.com')

    await client.delete(`/api/v1/tasks/${tarea.id}`).header('Authorization', `Bearer ${token}`)
    const segunda = await client
      .delete(`/api/v1/tasks/${tarea.id}`)
      .header('Authorization', `Bearer ${token}`)

    segunda.assertStatus(404)
  })

  test('un identificador que no es un número responde 404', async ({ client }) => {
    const token = await cuenta(client, 'ada@example.com')

    const respuesta = await client
      .delete('/api/v1/tasks/no-es-un-id')
      .header('Authorization', `Bearer ${token}`)

    respuesta.assertStatus(404)
  })
})
