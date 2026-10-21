import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Info,
  LoaderCircle,
  Plus,
  Search,
  X,
} from 'lucide-react'
import Badge from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import TextField from '../../components/ui/TextField'
import { createGroup, getCandidates, setMember, updateGroup } from './groups'
import type { Candidate, Group, GroupRole, Page } from './groups'
import FormFeedback, { FieldError } from '../../components/ui/FormFeedback'
import { useFormValidation } from '../../lib/useFormValidation'
import { textError } from '../../lib/validation'
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo completar la operación.'

export function Feedback({ text }: { text: string }) {
  return (
    <div className="groups-feedback" role="alert">
      <Info size={18} />
      <span>{text}</span>
    </div>
  )
}
export function Loading({ text }: { text: string }) {
  return (
    <p className="groups-loading" role="status">
      <LoaderCircle size={18} className="access-spinner" />
      {text}
    </p>
  )
}
export function Pagination({
  offset,
  total,
  size,
  loading,
  onChange,
}: {
  offset: number
  total: number
  size: number
  loading: boolean
  onChange: (offset: number) => void
}) {
  return (
    <div className="groups-pagination">
      <span>
        {total
          ? `${Math.min(offset + 1, total)}–${Math.min(offset + size, total)} de ${total}`
          : 'Sin resultados'}
      </span>
      <div>
        <Button
          variant="outline"
          aria-label="Página anterior"
          disabled={loading || offset === 0}
          onClick={() => onChange(Math.max(0, offset - size))}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          variant="outline"
          aria-label="Página siguiente"
          disabled={loading || offset + size >= total}
          onClick={() => onChange(offset + size)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  )
}

function CandidateSearch({
  groupId,
  selected,
  onPick,
  disabled,
}: {
  groupId: string | null
  selected: string[]
  onPick: (person: Candidate) => void
  disabled: boolean
}) {
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<Page<Candidate> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void getCandidates(groupId, search.trim(), offset, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setPage(value)
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(message(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [groupId, search, offset])
  return (
    <div className="groups-candidates">
      <TextField
        label="Buscar perfiles activos"
        icon={Search}
        placeholder="Nombre o correo"
        value={search}
        maxLength={80}
        disabled={disabled}
        onChange={(event) => {
          setSearch(event.target.value)
          setOffset(0)
        }}
      />
      {error ? (
        <Feedback text={error} />
      ) : loading ? (
        <Loading text="Buscando personas…" />
      ) : (
        <div className="groups-candidate-list">
          {page?.items.length === 0 && (
            <p className="groups-note">
              No hay perfiles activos disponibles con esta búsqueda.
            </p>
          )}
          {page?.items.map((person) => (
            <div className="groups-candidate" key={person.id}>
              <CircleUserRound size={23} />
              <div>
                <strong>{person.display_name}</strong>
                <small>{person.email}</small>
              </div>
              <Button
                variant="outline"
                disabled={disabled || selected.includes(person.id)}
                onClick={() => onPick(person)}
              >
                {selected.includes(person.id) ? (
                  <CheckCircle2 size={15} />
                ) : (
                  <Plus size={15} />
                )}
                {selected.includes(person.id) ? 'Seleccionado' : 'Seleccionar'}
              </Button>
            </div>
          ))}
        </div>
      )}
      <Pagination
        offset={offset}
        total={page?.total ?? 0}
        size={10}
        loading={loading || disabled}
        onChange={setOffset}
      />
    </div>
  )
}

export function GroupForm({
  group,
  onClose,
  onSaved,
}: {
  group: Group | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [active, setActive] = useState(group?.is_active ?? true)
  const [members, setMembers] = useState<
    { person: Candidate; role: GroupRole }[]
  >([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const validation = useFormValidation({
    name: textError(name, 'el nombre del grupo', 100),
    description: textError(description, 'el propósito del grupo', 500, true),
    members:
      !group && members.length < 2
        ? 'Selecciona al menos dos integrantes.'
        : '',
    manager:
      !group &&
      members.length >= 2 &&
      !members.some((member) => member.role === 'manager')
        ? 'Designa al menos un responsable en la lista de integrantes seleccionados.'
        : '',
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !validation.check()) return
    setBusy(true)
    setError('')
    try {
      const body = { name: name.trim(), description: description.trim() }
      if (group) {
        await updateGroup(group, { ...body, is_active: active })
        onSaved(group.id)
      } else {
        const created = await createGroup({
          ...body,
          members: members.map((member) => ({
            profile_id: member.person.id,
            group_role: member.role,
          })),
        })
        onSaved(created.id)
      }
    } catch (error) {
      setError(message(error))
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      busy={busy}
      title={group ? 'Editar grupo' : 'Crear grupo de trabajo'}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        noValidate
        aria-busy={busy}
        className="groups-form"
        onSubmit={(event) => void submit(event)}
      >
        <TextField
          {...validation.field('name')}
          label="Nombre del grupo"
          placeholder="Ej. Comité de cooperación diplomática"
          required
          maxLength={100}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <label className="field">
          <span className="field-label">Propósito del grupo</span>
          <textarea
            id={validation.id('description')}
            onBlur={validation.field('description').onBlur}
            aria-invalid={Boolean(validation.field('description').error)}
            aria-describedby={`${validation.id('description')}-error`}
            className="groups-textarea"
            maxLength={500}
            rows={3}
            value={description}
            disabled={busy}
            onChange={(event) =>
              setDescription(event.target.value.replace(/[\r\n\t]/g, ' '))
            }
            placeholder="Describe brevemente el trabajo de este equipo."
          />
          <FieldError
            id={validation.id('description')}
            error={validation.field('description').error}
          />
        </label>
        {group?.can_archive && (
          <label className="groups-active-choice">
            <input
              type="checkbox"
              checked={active}
              disabled={busy}
              onChange={(event) => setActive(event.target.checked)}
            />
            <span>
              <strong>Grupo activo</strong>
              <small>
                Al archivarlo se conserva su organización y se bloquean los
                cambios de integrantes.
              </small>
            </span>
          </label>
        )}
        {!group && (
          <>
            <div className="groups-section-heading">
              <h3
                id={validation.id('members')}
                tabIndex={-1}
                className="validation-target"
              >
                Integrantes del grupo
              </h3>
              <Badge tone="purple">{members.length} de 255</Badge>
            </div>
            <p className="groups-note">
              Selecciona al menos dos perfiles y designa un responsable. El
              creador no se incorpora automáticamente.
            </p>
            {members.length > 0 && (
              <div
                id={validation.id('manager')}
                tabIndex={-1}
                className="groups-selected validation-target"
              >
                {members.map((member) => (
                  <div key={member.person.id}>
                    <span>
                      <strong>{member.person.display_name}</strong>
                      <small>{member.person.email}</small>
                    </span>
                    <select
                      aria-label={`Papel de ${member.person.display_name}`}
                      value={member.role}
                      disabled={busy}
                      onChange={(event) => {
                        const nextRole = event.currentTarget.value as GroupRole
                        setMembers((values) =>
                          values.map((value) =>
                            value.person.id === member.person.id
                              ? {
                                  ...value,
                                  role: nextRole,
                                }
                              : value,
                          ),
                        )
                      }}
                    >
                      <option value="member">Integrante</option>
                      <option value="manager">Responsable</option>
                    </select>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Quitar selección de ${member.person.display_name}`}
                      disabled={busy}
                      onClick={() =>
                        setMembers((values) =>
                          values.filter(
                            (value) => value.person.id !== member.person.id,
                          ),
                        )
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <CandidateSearch
              groupId={null}
              selected={members.map((member) => member.person.id)}
              disabled={busy || members.length >= 255}
              onPick={(person) =>
                setMembers((values) =>
                  values.some((value) => value.person.id === person.id)
                    ? values
                    : [...values, { person, role: 'member' }],
                )
              }
            />
          </>
        )}
        <FormFeedback issues={validation.issues} busy={busy} />
        {error && <Feedback text={error} />}
        <div className="groups-form-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !validation.valid}>
            {busy && <LoaderCircle size={17} className="access-spinner" />}
            {busy ? 'Guardando…' : group ? 'Guardar cambios' : 'Crear grupo'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function AddMember({
  group,
  onClose,
  onSaved,
}: {
  group: Group
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [person, setPerson] = useState<Candidate | null>(null)
  const [role, setRole] = useState<GroupRole>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const validation = useFormValidation({
    person: !person ? 'Selecciona un perfil activo en la lista.' : '',
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !validation.check() || !person) return
    setBusy(true)
    setError('')
    try {
      await setMember(group, person.id, role)
      onSaved(group.id)
    } catch (error) {
      setError(message(error))
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      busy={busy}
      title="Agregar integrante"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        noValidate
        aria-busy={busy}
        className="groups-form"
        onSubmit={(event) => void submit(event)}
      >
        <p className="groups-note">
          Selecciona un perfil activo para incorporarlo a {group.name}.
        </p>
        <div
          id={validation.id('person')}
          tabIndex={-1}
          className="validation-target"
        >
          <CandidateSearch
            groupId={group.id}
            selected={person ? [person.id] : []}
            onPick={setPerson}
            disabled={busy}
          />
        </div>
        {person && (
          <div className="groups-add-selection">
            <strong>{person.display_name}</strong>
            <label className="field">
              <span className="field-label">Papel dentro del grupo</span>
              <select
                className="groups-select"
                value={role}
                disabled={busy}
                onChange={(event) => setRole(event.target.value as GroupRole)}
              >
                <option value="member">Integrante</option>
                <option value="manager">Responsable</option>
              </select>
            </label>
          </div>
        )}
        <FormFeedback issues={validation.issues} busy={busy} />
        {error && <Feedback text={error} />}
        <div className="groups-form-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !person}>
            {busy ? 'Agregando…' : 'Agregar integrante'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
