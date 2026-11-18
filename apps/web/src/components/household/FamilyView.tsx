'use client';
import { useState } from 'react';
import { Users, UserPlus, ShieldCheck, Phone, Trash2, Pencil } from 'lucide-react';
import { useHousehold } from '@/hooks/useHousehold';
import {
  createMember,
  removeMember,
  setCameraGrants,
  saveContact,
  removeContact,
  type Household,
  type HouseholdMember,
  type HouseholdContact,
  type CameraGrant,
} from '@/lib/household-client';
import styles from './household.module.css';

type Run = ReturnType<typeof useHousehold>['run'];
function MemberForm({
  provider,
  busy,
  run,
  onClose,
}: {
  provider: string;
  busy: boolean;
  run: Run;
  onClose: () => void;
}) {
  return (
    <form
      className={styles.form}
      aria-label="Thêm thành viên gia đình"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const ok = await run(
          () =>
            createMember({
              email: String(form.get('email')),
              fullName: String(form.get('fullName')),
              ...(provider === 'jwt'
                ? { password: String(form.get('password')) }
                : { cognitoSub: String(form.get('cognitoSub')) }),
            }),
          'Đã tạo tài khoản Viewer trong hộ. Hãy cấp quyền camera cho thành viên.',
        );
        if (ok) onClose();
      }}
    >
      <h3>Thêm thành viên Viewer</h3>
      <p>Tài khoản mới chỉ xem được những camera bạn cấp quyền.</p>
      <label>
        Họ tên
        <input name="fullName" required maxLength={120} disabled={busy} />
      </label>
      <label>
        Email
        <input name="email" type="email" required disabled={busy} />
      </label>
      {provider === 'jwt' ? (
        <label>
          Mật khẩu cấp cho thành viên
          <input
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            disabled={busy}
          />
        </label>
      ) : (
        <label>
          Mã người dùng Cognito
          <input name="cognitoSub" required disabled={busy} />
          <small>Tạo người dùng Viewer trên Cognito trước khi liên kết.</small>
        </label>
      )}
      <div className={styles.actions}>
        <button disabled={busy} type="submit">
          {busy ? 'Đang tạo…' : 'Tạo thành viên'}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Hủy
        </button>
      </div>
    </form>
  );
}
function GrantEditor({
  member,
  cameras,
  busy,
  run,
  onClose,
}: {
  member: HouseholdMember;
  cameras: Household['cameras'];
  busy: boolean;
  run: Run;
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<CameraGrant[]>(() =>
    cameras.map(
      (camera) =>
        member.grants.find((grant) => grant.cameraId === camera.id) ?? {
          cameraId: camera.id,
          canLive: false,
          canPlayback: false,
        },
    ),
  );
  function change(id: string, key: 'canLive' | 'canPlayback', checked: boolean) {
    setGrants((old) =>
      old.map((grant) => (grant.cameraId === id ? { ...grant, [key]: checked } : grant)),
    );
  }
  return (
    <form
      className={styles.form}
      aria-label={`Quyền camera của ${member.fullName}`}
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          await run(
            () => setCameraGrants(member.id, grants),
            'Đã cập nhật quyền camera. Thay đổi có hiệu lực với yêu cầu tiếp theo.',
          )
        )
          onClose();
      }}
    >
      <h3>
        <ShieldCheck size={18} /> Quyền camera · {member.fullName}
      </h3>
      <div className={styles.tableScroll}>
        <table>
          <thead>
            <tr>
              <th>Camera</th>
              <th>Xem trực tiếp</th>
              <th>Xem lại</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((camera) => {
              const grant = grants.find((item) => item.cameraId === camera.id)!;
              return (
                <tr key={camera.id}>
                  <td>{camera.name}</td>
                  <td>
                    <input
                      type="checkbox"
                      disabled={busy}
                      aria-label={`Xem trực tiếp ${camera.name}`}
                      checked={grant.canLive}
                      onChange={(event) => change(camera.id, 'canLive', event.target.checked)}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      disabled={busy}
                      aria-label={`Xem lại ${camera.name}`}
                      checked={grant.canPlayback}
                      onChange={(event) => change(camera.id, 'canPlayback', event.target.checked)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!cameras.length && <p>Chưa có camera trong hộ để cấp quyền.</p>}
      <div className={styles.actions}>
        <button disabled={busy} type="submit">
          Lưu quyền truy cập
        </button>
        <button disabled={busy} type="button" onClick={onClose}>
          Hủy
        </button>
      </div>
    </form>
  );
}
function ContactForm({
  contact,
  busy,
  run,
  onClose,
}: {
  contact: HouseholdContact | null;
  busy: boolean;
  run: Run;
  onClose: () => void;
}) {
  return (
    <form
      className={styles.form}
      aria-label="Liên hệ khẩn cấp"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (
          await run(
            () =>
              saveContact(
                {
                  name: String(form.get('name')),
                  phone: String(form.get('phone')),
                  priority: Number(form.get('priority')),
                  isEnabled: form.get('enabled') === 'on',
                },
                contact?.id,
              ),
            'Đã lưu liên hệ khẩn cấp.',
          )
        )
          onClose();
      }}
    >
      <h3>{contact ? 'Sửa' : 'Thêm'} liên hệ khẩn cấp</h3>
      <label>
        Họ tên
        <input name="name" required maxLength={120} defaultValue={contact?.name} disabled={busy} />
      </label>
      <label>
        Điện thoại
        <input
          name="phone"
          type="tel"
          required
          pattern="\+[1-9][0-9]{7,14}"
          placeholder="+84901234567"
          defaultValue={contact?.phone}
          disabled={busy}
        />
      </label>
      <label>
        Thứ tự liên hệ
        <select name="priority" defaultValue={contact?.priority ?? 1} disabled={busy}>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={contact?.isEnabled ?? true}
          disabled={busy}
        />{' '}
        Sử dụng liên hệ này
      </label>
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>
          Lưu liên hệ
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Hủy
        </button>
      </div>
    </form>
  );
}
export function FamilyView() {
  const state = useHousehold();
  const [adding, setAdding] = useState(false),
    [selected, setSelected] = useState<HouseholdMember | null>(null),
    [contact, setContact] = useState<HouseholdContact | null | undefined>(undefined),
    [remove, setRemove] = useState<{ id: string; name: string; kind: 'member' | 'contact' } | null>(
      null,
    );
  const { data, busy, run } = state;
  if (state.loading) return <p role="status">Đang tải gia đình…</p>;
  return (
    <section className={styles.page} aria-labelledby="family-title">
      <header className={styles.heading}>
        <div>
          <h2 id="family-title">
            <Users size={23} /> Thành viên gia đình
          </h2>
          <p>Quản lý người trong hộ, camera được chia sẻ và liên hệ khẩn cấp.</p>
        </div>
        <button onClick={() => setAdding(true)} disabled={busy || !data}>
          <UserPlus size={17} />
          Thêm thành viên
        </button>
      </header>
      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className={styles.notice} role="status">
          {state.notice}
        </p>
      )}
      {data && (
        <>
          {adding && (
            <MemberForm
              provider={data.authProvider}
              busy={busy}
              run={run}
              onClose={() => setAdding(false)}
            />
          )}
          <div className={styles.members}>
            {data.members.map((member) => (
              <article key={member.id} className={styles.member}>
                <span className={styles.avatar}>{member.fullName.slice(0, 1)}</span>
                <div>
                  <h3>
                    {member.fullName}
                    <small>{member.role === 'CAREGIVER' ? 'Chủ hộ' : 'Viewer'}</small>
                  </h3>
                  <p>{member.email}</p>
                  <p>{member.telegramLinked ? 'Đã liên kết Telegram' : 'Chưa liên kết Telegram'}</p>
                </div>
                {member.role === 'VIEWER' && (
                  <div className={styles.actions}>
                    <button disabled={busy} onClick={() => setSelected(member)}>
                      <ShieldCheck size={15} /> Quyền camera
                    </button>
                    <button
                      className={styles.danger}
                      disabled={busy}
                      onClick={() =>
                        setRemove({ id: member.id, name: member.fullName, kind: 'member' })
                      }
                    >
                      <Trash2 size={15} /> Xóa khỏi hộ
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {selected && (
            <GrantEditor
              key={selected.id}
              member={selected}
              cameras={data.cameras}
              busy={busy}
              run={run}
              onClose={() => setSelected(null)}
            />
          )}
          <section className={styles.panel}>
            <header className={styles.heading}>
              <div>
                <h3>
                  <Phone size={19} /> Liên hệ khẩn cấp
                </h3>
                <p>
                  Tối đa 3 liên hệ, theo thứ tự ưu tiên. Gọi điện tự động cần kênh điện thoại được
                  triển khai và xác minh.
                </p>
              </div>
              <button disabled={busy || data.contacts.length >= 3} onClick={() => setContact(null)}>
                Thêm liên hệ
              </button>
            </header>
            {data.contacts.length === 0 && <p>Chưa có liên hệ khẩn cấp.</p>}
            {data.contacts.map((item) => (
              <div className={styles.contact} key={item.id}>
                <strong>
                  {item.priority}. {item.name}
                </strong>
                <span>{item.phone}</span>
                <small>
                  {item.isEnabled ? 'Đang dùng' : 'Đã tắt'} ·{' '}
                  {item.isVerified ? 'Đã xác minh' : 'Chưa xác minh kênh gọi'}
                </small>
                <button disabled={busy} onClick={() => setContact(item)}>
                  <Pencil size={14} />
                  Sửa
                </button>
                <button
                  className={styles.danger}
                  disabled={busy}
                  onClick={() => setRemove({ id: item.id, name: item.name, kind: 'contact' })}
                >
                  <Trash2 size={14} />
                  Xóa
                </button>
              </div>
            ))}
            {contact !== undefined && (
              <ContactForm
                key={contact?.id ?? 'new'}
                contact={contact}
                busy={busy}
                run={run}
                onClose={() => setContact(undefined)}
              />
            )}
          </section>
          {remove && (
            <div className={styles.confirm} role="alert">
              <p>
                {remove.kind === 'member'
                  ? 'Thu hồi toàn bộ quyền và vô hiệu hóa tài khoản'
                  : 'Xóa liên hệ'}{' '}
                “{remove.name}”?
              </p>
              <div className={styles.actions}>
                <button
                  className={styles.danger}
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await run(
                        () =>
                          remove.kind === 'member'
                            ? removeMember(remove.id)
                            : removeContact(remove.id),
                        'Đã xóa và cập nhật quyền truy cập.',
                      )
                    ) {
                      setSelected(null);
                      setRemove(null);
                    }
                  }}
                >
                  Xác nhận xóa
                </button>
                <button disabled={busy} onClick={() => setRemove(null)}>
                  Hủy
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
