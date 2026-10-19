'use client';

/** Hospital-owned management reads and explicit, online-only writes. FR-ADM-11. */
import { useCallback, useEffect, useRef, useState } from 'react';

import { retryDelayMs } from '@platform/client';
import { isHospitalModule } from '@platform/domain';
import { format, formatNumber, numeralsFor, localName, t } from '@platform/i18n';
import { Button, Card, FreshnessLine, Sheet, useLocale, useToast } from '@platform/ui';

import { useAdminManagement } from '@/components/AdminManagementContext';
import {
  AddDoctor,
  MODULE_KEY,
  BedsTab,
  CapabilitiesTab,
  DepartmentsTab,
  DoctorCard,
  ProfileTab,
  SetupStatus,
  StaffTab,
  failureText,
} from '@/components/AdminManagementPanels';
import { DeskSettings } from '@/components/DeskSettings';
import { StaffDeskAssignments } from '@/components/StaffDeskAssignments';
import { loadDesks, loadSetup } from '@/lib/settings';

export function AdminManagement({ page, initialGroup, onModules }) {
  const locale = useLocale();
  const management = useAdminManagement();
  const setReadFailed = management?.setReadFailed;
  const { show } = useToast();
  const [snapshot, setSnapshot] = useState(null);
  const [desks, setDesks] = useState(null);
  const [failed, setFailed] = useState(false);
  const [unreached, setUnreached] = useState(0);
  const [message, setMessage] = useState('');
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [group, setGroup] = useState(initialGroup ?? 'home');
  const [person, setPerson] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const reading = useRef(0);
  const writing = useRef(false);
  useEffect(() => {
    setReadFailed?.(failed);
    return () => setReadFailed?.(false);
  }, [failed, setReadFailed]);
  const panelFocus = useRef(null);
  const openPerson = (id) =>
    management?.navigate(() => {
      panelFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPerson(id);
    });
  const reload = useCallback(async () => {
    const request = ++reading.current;
    const result = await loadSetup();
    if (request !== reading.current) return false;
    if (result === 'offline' || result === 'error') {
      setFailed(true);
      setUnreached((count) => count + 1);
      setOffline(result === 'offline' || !navigator.onLine);
      return false;
    }
    setSnapshot(result);
    setFailed(false);
    setUnreached(0);
    setOffline(!navigator.onLine);
    onModules(result.hospital.modulesOff, result.serverTs);
    const deskResult = await loadDesks();
    if (request === reading.current) setDesks(typeof deskResult === 'string' ? null : deskResult);
    return true;
  }, [onModules]);
  useEffect(() => {
    void reload();
    return () => {
      reading.current++;
    };
  }, [reload]);
  useEffect(() => {
    if (!failed || !navigator.onLine) return;
    const timer = setTimeout(() => void reload(), retryDelayMs(unreached));
    return () => clearTimeout(timer);
  }, [failed, unreached, reload]);
  useEffect(() => {
    const lost = () => setOffline(true);
    const restored = () => {
      setOffline(false);
      void reload();
    };
    globalThis.addEventListener('offline', lost);
    globalThis.addEventListener('online', restored);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      globalThis.removeEventListener('offline', lost);
      globalThis.removeEventListener('online', restored);
      clearInterval(timer);
    };
  }, [reload]);
  const run = useCallback(
    async (call, success, review) => {
      if (writing.current || offline || failed || snapshot === null || management === null)
        return false;
      const accepted = await management.confirm({
        title: t('manageReview', locale),
        note: t('manageReviewNote', locale),
        ...review,
        scope: `${localName(locale, snapshot.hospital.nameBn, snapshot.hospital.nameEn)}${review?.scope ? ' · ' + review.scope : ''}`,
      });
      if (!accepted || writing.current || !navigator.onLine) return false;
      writing.current = true;
      management.setBusy(true);
      setMessage('');
      try {
        const result = await call();
        if (!result.ok) {
          const text =
            result.failure.kind === 'offline' || result.failure.kind === 'failed'
              ? t('manageUncertain', locale)
              : failureText(result.failure, locale);
          setMessage(text);
          show({ title: text, tone: 'alert' });
          await reload();
          return false;
        }
        const text = success(result.value);
        const read = await reload();
        setMessage(read ? '' : t('manageReadFailedAfterSave', locale));
        show({
          title: read ? text : t('manageReadFailedAfterSave', locale),
          tone: read ? 'positive' : 'caution',
        });
        return true;
      } catch {
        setMessage(t('manageUncertain', locale));
        await reload();
        return false;
      } finally {
        writing.current = false;
        management.setBusy(false);
      }
    },
    [offline, failed, snapshot, management, locale, reload, show],
  );
  const navigate = (next) => management?.navigate(next);
  if (snapshot === null)
    return (
      <Card aria-busy={!failed}>
        {failed ? (
          <>
            <p role="alert">{t(offline ? 'settingsOffline' : 'loadFailed', locale)}</p>
            <Button onClick={() => void reload()}>{t('retry', locale)}</Button>
          </>
        ) : (
          <div className="admin-loading" />
        )}
      </Card>
    );
  const props = { snapshot, run, offline: offline || failed || management?.busy === true };
  const hospital = localName(locale, snapshot.hospital.nameBn, snapshot.hospital.nameEn);
  const changeGroup = (next) =>
    navigate(() => {
      setGroup(next);
      setPerson(null);
    });
  const close = () => navigate(() => setPerson(null));
  const staff = snapshot.staff
    .filter(
      (member) =>
        member.fullName.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
        member.email.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .filter((member) => status === 'all' || (status === 'active') === member.isActive)
    .filter((member) => roleFilter === 'all' || member.roles.includes(roleFilter));
  const doctors = snapshot.doctors
    .filter((doctor) =>
      `${doctor.nameBn} ${doctor.nameEn} ${doctor.bmdcNumber}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    .filter((doctor) => status === 'all' || (status === 'active') === doctor.isActive)
    .filter((doctor) => departmentFilter === 'all' || doctor.departmentId === departmentFilter);
  const selectedStaff = snapshot.staff.find((member) => member.id === person);
  const selectedDoctor = snapshot.doctors.find((doctor) => doctor.doctorHospitalId === person);
  const groups =
    page === 'staff'
      ? [
          ['home', 'manageStaffList'],
          ['desks', 'manageDesks'],
          ['access', 'manageAccess'],
        ]
      : page === 'doctors'
        ? [
            ['home', 'adminNavDoctors'],
            ['departments', 'settingsTabDepartments'],
          ]
        : [];
  const settingsGroups = [
    ['profile', 'manageProfile'],
    ['face', 'manageFace'],
    ['rules', 'manageRules'],
    ['beds', 'settingsTabBeds'],
    ['capabilities', 'settingsTabCapabilities'],
    ['identity', 'manageRegistration'],
    ['sms', 'manageSms'],
  ];
  return (
    <section className="admin-management" data-testid="hospital-settings">
      {snapshot.hospital.modulesOff.length > 0 ? (
        <p role="status" data-testid="settings-modules-off">
          {format('settingsModulesOff', locale, {
            modules: snapshot.hospital.modulesOff
              .map((name) => (isHospitalModule(name) ? t(MODULE_KEY[name], locale) : name))
              .join(', '),
          })}
        </p>
      ) : null}
      <FreshnessLine
        asOf={new Date(snapshot.serverTs)}
        now={new Date(now)}
        staleAfterMinutes={snapshot.rules.staleThresholdMinutes}
        labels={{
          justNow: t('updatedJustNow', locale),
          ago: t('updatedAgo', locale),
          never: t('adminNeverRecorded', locale),
          stale: t('staleWarning', locale),
        }}
        formatMinutes={(minutes) => formatNumber(minutes, numeralsFor(locale))}
      />
      {offline ? (
        <p role="status" data-testid="settings-offline-banner">
          {t('settingsOffline', locale)}
        </p>
      ) : null}
      {failed ? (
        <p role="alert">
          {t('loadFailed', locale)}{' '}
          <Button variant="secondary" onClick={() => void reload()}>
            {t('retry', locale)}
          </Button>
        </p>
      ) : null}
      {message ? (
        <p className="admin-save-message" role="alert">
          {message}
        </p>
      ) : null}
      {groups.length ? (
        <nav className="admin-subnav">
          {groups.map(([id, key]) => (
            <button
              key={id}
              type="button"
              aria-current={group === id ? 'page' : undefined}
              onClick={() => changeGroup(id)}
              data-testid={`management-group-${id}`}
            >
              {t(key, locale)}
            </button>
          ))}
        </nav>
      ) : null}
      {page === 'settings' ? (
        group === 'home' ? (
          <>
            <SetupStatus {...props} />
            {['managePatientSettings', 'manageDailySettings', 'manageOccasionalSettings'].map(
              (category, index) => (
                <section key={category} className="admin-setting-group">
                  <h2>{t(category, locale)}</h2>
                  <div className="admin-settings-grid">
                    {settingsGroups
                      .filter(([id]) =>
                        index === 0
                          ? ['profile', 'face'].includes(id)
                          : index === 1
                            ? ['rules', 'beds', 'capabilities'].includes(id)
                            : ['identity', 'sms'].includes(id),
                      )
                      .filter(([id]) =>
                        id === 'beds'
                          ? !snapshot.hospital.modulesOff.includes('beds')
                          : id === 'capabilities'
                            ? !snapshot.hospital.modulesOff.includes('emergency')
                            : true,
                      )
                      .map(([id, key]) => (
                        <button
                          className="admin-setting-card"
                          key={id}
                          onClick={() => changeGroup(id)}
                          data-testid={`settings-group-${id}`}
                        >
                          <span className="admin-setting-icon" aria-hidden="true">
                            <svg
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                            >
                              <path
                                d={
                                  id === 'face'
                                    ? 'M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4'
                                    : id === 'rules'
                                      ? 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6'
                                      : 'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5'
                                }
                              />
                            </svg>
                          </span>
                          <strong>{t(key, locale)}</strong>
                          <span aria-hidden="true">›</span>
                        </button>
                      ))}
                  </div>
                </section>
              ),
            )}
            {!snapshot.hospital.modulesOff.includes('import') ? (
              <a
                href="/?view=imports"
                data-testid="settings-open-import"
                onClick={(event) => {
                  event.preventDefault();
                  navigate(() => globalThis.location.assign('/?view=imports'));
                }}
              >
                {t('moduleImport', locale)} →
              </a>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="quiet" onClick={() => changeGroup('home')} data-testid="settings-back">
              ← {t('manageBackSettings', locale)}
            </Button>
            {group === 'beds' ? (
              <BedsTab {...props} />
            ) : group === 'capabilities' ? (
              <CapabilitiesTab {...props} now={new Date(now)} />
            ) : (
              <ProfileTab key={group} {...props} section={group} />
            )}
          </>
        )
      ) : group === 'desks' ? (
        <DeskSettings {...props} />
      ) : group === 'departments' ? (
        <DepartmentsTab {...props} />
      ) : group === 'access' ? (
        <Card>
          <h2>{t('manageAccess', locale)}</h2>
          <p>{t('manageDeskConsequence', locale)}</p>
          <p>{t('manageRoleAccess', locale)}</p>
          <div className="admin-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('settingsStaffName', locale)}</th>
                  <th>{t('settingsStaffRoles', locale)}</th>
                  <th>{t('manageDesks', locale)}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.staff.map((member) => (
                  <tr key={member.id}>
                    <th>{member.fullName}</th>
                    <td>{member.roles.map((role) => roleName(role, locale)).join(', ')}</td>
                    <td>
                      {!member.isActive
                        ? t('manageInactive', locale)
                        : desks === null
                          ? t('loadFailed', locale)
                          : desks
                              .filter((desk) => desk.staffIds.includes(member.id))
                              .map((desk) => localName(locale, desk.nameBn, desk.nameEn))
                              .join(', ') ||
                            (member.roles.includes('receptionist')
                              ? t('manageNoDesk', locale)
                              : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="admin-list-tools">
            <label>
              <span className="sr-only">
                {t(page === 'staff' ? 'manageSearchStaff' : 'manageSearchDoctors', locale)}
              </span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(
                  page === 'staff' ? 'manageSearchStaff' : 'manageSearchDoctors',
                  locale,
                )}
                data-testid="management-search"
              />
            </label>
            <select
              aria-label={t('manageActive', locale)}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">{t('manageAll', locale)}</option>
              <option value="active">{t('manageActive', locale)}</option>
              <option value="inactive">{t('manageInactive', locale)}</option>
            </select>
            {page === 'staff' ? (
              <select
                aria-label={t('settingsStaffRoles', locale)}
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
              >
                <option value="all">{t('manageAll', locale)}</option>
                {ROLE_COPY.map(([role]) => (
                  <option key={role} value={role}>
                    {roleName(role, locale)}
                  </option>
                ))}
              </select>
            ) : (
              <select
                aria-label={t('settingsDepartment', locale)}
                value={departmentFilter}
                onChange={(event) => setDepartmentFilter(event.target.value)}
              >
                <option value="all">{t('manageAll', locale)}</option>
                {snapshot.departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {localName(locale, dept.nameBn, dept.nameEn)}
                  </option>
                ))}
              </select>
            )}
            <Button onClick={() => openPerson('add')} data-testid="management-add">
              + {t(page === 'staff' ? 'settingsAddStaff' : 'settingsAddDoctor', locale)}
            </Button>
          </div>
          <div className="admin-table-scroll">
            <table className="admin-person-table">
              <thead>
                <tr>
                  <th>{t(page === 'staff' ? 'settingsStaffName' : 'adminNavDoctors', locale)}</th>
                  <th>
                    {t(page === 'staff' ? 'settingsStaffRoles' : 'settingsDepartment', locale)}
                  </th>
                  <th>{t('manageDesks', locale)}</th>
                  <th>{t(page === 'staff' ? 'manageLastLogin' : 'settingsFee', locale)}</th>
                  <th>{t('manageActive', locale)}</th>
                  <th>
                    <span className="sr-only">{t('manageChange', locale)}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page === 'staff'
                  ? staff.map((member) => (
                      <tr key={member.id} data-testid={`management-person-${member.id}`}>
                        <th>
                          {member.fullName}
                          <small>
                            {member.email}
                            <br />
                            {hospital}
                          </small>
                        </th>
                        <td>{member.roles.map((role) => roleName(role, locale)).join(', ')}</td>
                        <td>
                          {desks === null
                            ? t('loadFailed', locale)
                            : desks
                                .filter((desk) => desk.staffIds.includes(member.id))
                                .map((desk) => localName(locale, desk.nameBn, desk.nameEn))
                                .join(', ') ||
                              (member.roles.includes('receptionist')
                                ? t('manageNoDesk', locale)
                                : '—')}
                        </td>
                        <td>
                          {member.lastLoginAt === null
                            ? t('manageNeverLogin', locale)
                            : new Date(member.lastLoginAt).toLocaleString(
                                locale === 'bn' ? 'bn-BD' : 'en-GB',
                                { timeZone: 'Asia/Dhaka' },
                              )}
                        </td>
                        <td>
                          <span className={`admin-status ${member.isActive ? 'is-active' : ''}`}>
                            {t(member.isActive ? 'manageActive' : 'manageInactive', locale)}
                          </span>
                        </td>
                        <td>
                          <Button
                            variant="quiet"
                            onClick={() => openPerson(member.id)}
                            data-testid={`management-change-${member.id}`}
                          >
                            {t('manageChange', locale)}
                          </Button>
                        </td>
                      </tr>
                    ))
                  : doctors.map((doctor) => (
                      <tr
                        key={doctor.doctorHospitalId}
                        data-testid={`management-person-${doctor.doctorHospitalId}`}
                      >
                        <th>
                          {localName(locale, doctor.nameBn, doctor.nameEn)}
                          <small>
                            {doctor.bmdcNumber}
                            <br />
                            {doctor.degrees}
                          </small>
                        </th>
                        <td>
                          {snapshot.departments
                            .filter((department) => department.id === doctor.departmentId)
                            .map((department) =>
                              localName(locale, department.nameBn, department.nameEn),
                            )
                            .join(', ')}
                          <small>{doctor.room}</small>
                        </td>
                        <td>
                          {desks === null
                            ? t('loadFailed', locale)
                            : desks
                                .filter((desk) => desk.doctorIds.includes(doctor.doctorId))
                                .map((desk) => localName(locale, desk.nameBn, desk.nameEn))
                                .join(', ') || '—'}
                        </td>
                        <td>
                          {(doctor.feePoisha / 100).toLocaleString(
                            locale === 'bn' ? 'bn-BD' : 'en-GB',
                          )}
                          <small>
                            {
                              snapshot.templates.filter(
                                (template) => template.doctorHospitalId === doctor.doctorHospitalId,
                              ).length
                            }{' '}
                            {t('settingsSchedules', locale)}
                          </small>
                        </td>
                        <td>
                          <span className={`admin-status ${doctor.isActive ? 'is-active' : ''}`}>
                            {t(doctor.isActive ? 'manageActive' : 'manageInactive', locale)}
                          </span>
                        </td>
                        <td>
                          <Button
                            variant="quiet"
                            onClick={() => openPerson(doctor.doctorHospitalId)}
                            data-testid={`management-change-${doctor.doctorHospitalId}`}
                          >
                            {t('manageChange', locale)}
                          </Button>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
            {(page === 'staff' ? staff : doctors).length === 0 ? (
              <p className="admin-empty">{t('manageNoMatches', locale)}</p>
            ) : null}
          </div>
          {page === 'staff' ? (
            <details className="admin-role-help">
              <summary>{t('settingsStaffRoles', locale)}</summary>
              <p>{t('manageRoleAccess', locale)}</p>
              {ROLE_COPY.map(([role, key]) => (
                <p key={role}>
                  <strong>{roleName(role, locale)}</strong> — {t(key, locale)}
                </p>
              ))}
            </details>
          ) : null}
        </Card>
      )}
      <Sheet
        console
        className="admin-person-sheet"
        variant="modal"
        restoreFocusTo={() => panelFocus.current}
        open={person !== null}
        title={
          person === 'add'
            ? t(page === 'staff' ? 'settingsAddStaff' : 'settingsAddDoctor', locale)
            : (selectedStaff?.fullName ??
              (selectedDoctor
                ? localName(locale, selectedDoctor.nameBn, selectedDoctor.nameEn)
                : ''))
        }
        description={hospital}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <div className="admin-workspace admin-person-panel">
          <Button
            variant="quiet"
            {...(management?.busy
              ? { disabled: true, disabledReason: t('manageSaving', locale) }
              : {})}
            onClick={close}
            data-testid="management-close"
          >
            {t('manageClose', locale)}
          </Button>
          {page === 'staff' ? (
            <>
              <StaffTab {...props} memberId={person ?? 'add'} />
              {selectedStaff &&
              (selectedStaff.roles.includes('receptionist') ||
                management?.drafts.has(`staff-desks-${selectedStaff.id}`)) ? (
                <StaffDeskAssignments
                  member={selectedStaff}
                  snapshot={snapshot}
                  offline={
                    props.offline ||
                    !selectedStaff.isActive ||
                    !selectedStaff.roles.includes('receptionist')
                  }
                  onChanged={reload}
                />
              ) : null}
            </>
          ) : person === 'add' ? (
            <AddDoctor {...props} />
          ) : selectedDoctor ? (
            <DoctorCard {...props} doctor={selectedDoctor} />
          ) : null}
        </div>
      </Sheet>
    </section>
  );
}

const ROLE_COPY = [
  ['receptionist', 'manageRoleReceptionist'],
  ['doctor', 'manageRoleDoctor'],
  ['ward', 'manageRoleWard'],
  ['emergency', 'manageRoleEmergency'],
  ['lab', 'manageRoleLab'],
  ['pharmacy', 'manageRolePharmacy'],
  ['hospital_admin', 'manageRoleAdmin'],
];
export function roleName(role, locale) {
  const names = {
    receptionist: 'roleReceptionist',
    doctor: 'roleDoctor',
    ward: 'roleWard',
    emergency: 'roleEmergency',
    lab: 'roleLab',
    pharmacy: 'rolePharmacy',
    hospital_admin: 'roleHospitalAdmin',
  };
  return Object.hasOwn(names, role) ? t(names[role], locale) : role;
}
