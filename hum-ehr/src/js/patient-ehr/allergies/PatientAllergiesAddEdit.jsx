import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';
import { Dialog } from 'primereact/dialog';
import { savePatientAllergy } from '../../../services/allergyService';
import { fetchAllergyLookup } from '../../../services/lookupService';
import { LOOKUP_MIN_CHARS } from '../../../constants/timing';
import PatientAllergiesReactions from './PatientAllergiesReactions';
import FlatpickrDateTimeInput from '../../../components/common/FlatpickrDateTimeInput';
import { useNotify } from '../../../context/NotificationContext';

const VERIFICATION_STATUS = {
    CONFIRMED: 'VERSTSC',
    UNCONFIRMED: 'VERSTSU',
    REFUTED: 'VERSTSR',
    ENTERED_IN_ERROR: 'VERSTSE',
};
const CLINICAL_STATUS = {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    RESOLVED: 'RESOLVED',
};

const NKA_TYPES = ['NKA', 'NKDA'];
const RESOLUTION_STATUSES = [CLINICAL_STATUS.INACTIVE, CLINICAL_STATUS.RESOLVED];

// Mirrors the legacy jQuery validation rules from patient.allergies.js:
//   pa_patient_allergy_type       → required
//   pa_patient_allergy_sub_type   → required (non-NKA), minlength:3, maxlength:300, allowOnlyLookupData
//   pa_patient_allergy_description→ required (non-NKA), minlength:2, maxlength:5000
//   pa_patient_allergy_clinical_status → required unless verificationStatus === VERSTSE
//   pa_patient_allergy_end_date   → required when clinicalStatus OR verificationStatus is INACTIVE/RESOLVED
//   pa_patient_allergy_onset_date → required when endDate is set
//   pa_patient_allergy_change_log_message → required
const allergySchema = z
    .object({
        allergyType: z.string().min(1, 'Allergy Type is required.'),
        allergySubType: z.string().max(300, 'Maximum 300 characters.'),
        allergySubTypeId: z.string(),
        description: z.string().max(5000, 'Maximum 5000 characters.'),
        recordedDate: z.string(),
        onsetDate: z.string(),
        endDate: z.string(),
        criticalityId: z.string(),
        verificationStatus: z.string(),
        clinicalStatus: z.string(),
        changeLogNotes: z.string().optional().default(''),
    })
    .superRefine((data, ctx) => {
        const isNKA = NKA_TYPES.includes(data.allergyType);

        if (!isNKA) {
            const subTypeTrimmed = data.allergySubType.trim();
            if (!subTypeTrimmed) {
                // field is empty — required message
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['allergySubType'], message: 'Allergy Subtype is required.' });
            } else if (subTypeTrimmed.length < 3) {
                // typed something but too short
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['allergySubType'], message: 'Minimum 3 characters.' });
            } else if (!data.allergySubTypeId) {
                // typed ≥3 chars but never selected from the lookup list (allowOnlyLookupData)
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['allergySubType'], message: 'Please select Allergy Subtype from the search list.' });
            }

            const descTrimmed = data.description.trim();
            if (!descTrimmed) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['description'], message: 'Allergy Description is required.' });
            } else if (descTrimmed.length < 2) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['description'], message: 'Minimum 2 characters.' });
            }

            // clinical status required unless verification is "Entered in Error"
            if (!data.clinicalStatus && data.verificationStatus !== VERIFICATION_STATUS.ENTERED_IN_ERROR) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clinicalStatus'], message: 'Clinical status is required.' });
            }
        }

        // end date required when EITHER clinicalStatus OR verificationStatus is INACTIVE/RESOLVED
        const resolutionRequired =
            RESOLUTION_STATUSES.includes(data.clinicalStatus) ||
            RESOLUTION_STATUSES.includes(data.verificationStatus);
        if (resolutionRequired && !data.endDate) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'Date of Resolution is required.' });
        }

        // onset date required whenever end date is set
        if (data.endDate && !data.onsetDate) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['onsetDate'], message: 'Onset Date and time is required.' });
        }
    });

const toFlatpickrDateTimeValue = (value) => {
    if (!value) return '';
    const stringValue = String(value).trim();
    if (/^\d{2}-\d{2}-\d{4}/.test(stringValue)) return stringValue;
    const date = new Date(stringValue.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return stringValue;
    const pad = (input) => String(input).padStart(2, '0');
    let hours = date.getHours();
    const minutes = pad(date.getMinutes());
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${date.getFullYear()} ${pad(hours)}:${minutes} ${period}`;
};

const buildDefaultValues = (allergyRecord) => {
    if (!allergyRecord?.allergyId) {
        return {
            allergyType: '',
            allergySubType: '',
            allergySubTypeId: '',
            description: '',
            recordedDate: '',
            onsetDate: '',
            endDate: '',
            criticalityId: '',
            verificationStatus: VERIFICATION_STATUS.CONFIRMED,
            clinicalStatus: CLINICAL_STATUS.ACTIVE,
            changeLogNotes: '',
        };
    }
    return {
        allergyType: allergyRecord.allergyTypeCode || '',
        allergySubType: allergyRecord.allergySubType || '',
        allergySubTypeId: allergyRecord.allergySubTypeId || '',
        description: allergyRecord.description || '',
        recordedDate: toFlatpickrDateTimeValue(allergyRecord.effectiveDate),
        onsetDate: toFlatpickrDateTimeValue(allergyRecord.onSetDate),
        endDate: toFlatpickrDateTimeValue(allergyRecord.lastEffectiveDate),
        criticalityId: allergyRecord.criticalityId || '',
        verificationStatus: allergyRecord.verificationStatusCode || VERIFICATION_STATUS.CONFIRMED,
        clinicalStatus: allergyRecord.allergyClinicalStatusCode || CLINICAL_STATUS.ACTIVE,
        changeLogNotes: '',
    };
};

const FieldError = ({ message }) =>
    message ? <div className="small text-danger mt-1">{message}</div> : null;

const PatientAllergiesAddEdit = ({ patientId, allergyRecord, actionType, recordType, lookups, onClose }) => {
    const [reactionsList, setReactionsList] = useState(allergyRecord?.reactionMapping || []);
    const [reactionModal, setReactionModal] = useState(false);
    const [editingReaction, setEditingReaction] = useState(null);
    const [saving, setSaving] = useState(false);
    const { notifyError } = useNotify();

    const isEditMode = !!allergyRecord?.allergyId;
    const isRecoverMode = actionType === 'recover';

    const { control, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm({
        resolver: zodResolver(allergySchema),
        defaultValues: buildDefaultValues(allergyRecord),
        mode: 'onSubmit',
        reValidateMode: 'onChange',
    });

    const allergyType = watch('allergyType');
    const clinicalStatus = watch('clinicalStatus');
    const verificationStatus = watch('verificationStatus');
    const allergySubType = watch('allergySubType');
    const allergySubTypeId = watch('allergySubTypeId');
    const description = watch('description');

    const isNKALocked = NKA_TYPES.includes(allergyType);
    const isEndDateDisabled = clinicalStatus === CLINICAL_STATUS.ACTIVE || isNKALocked;

    const existingReactionIds = useMemo(
        () => reactionsList.map((r) => r.reactionId),
        [reactionsList],
    );

    // Field ID helper — per-patient so multiple open charts don't collide.
    const fieldId = (base) => `${base}_${patientId}`;

    useEffect(() => {
        reset(buildDefaultValues(allergyRecord));
        setReactionsList(allergyRecord?.reactionMapping || []);
    }, [allergyRecord, reset]);

    // NKA/NKDA auto-fill: lock subfields and set canonical description
    useEffect(() => {
        if (!isNKALocked) return;
        setValue('allergySubType', '');
        setValue('allergySubTypeId', '');
        setValue('criticalityId', '');
        setValue('description', allergyType === 'NKDA' ? 'No Known Drug Allergies' : 'No Known Allergies');
        setValue('clinicalStatus', CLINICAL_STATUS.ACTIVE);
        setValue('verificationStatus', VERIFICATION_STATUS.CONFIRMED);
        setValue('endDate', '');
        setReactionsList([]);
    }, [allergyType, isNKALocked, setValue]);

    // Clear end date when clinical status switches back to Active
    useEffect(() => {
        if (clinicalStatus === CLINICAL_STATUS.ACTIVE) {
            setValue('endDate', '');
        }
    }, [clinicalStatus, setValue]);

    const buildSavePayload = (data) => ({
        activeFlag: recordType === 'history' ? 'N' : 'Y',
        patientId,
        careplanId: allergyRecord?.careplanId || null,
        allergyId: allergyRecord?.allergyId || null,
        allergyType: data.allergyType,
        allergySubType: isNKALocked ? null : data.allergySubType,
        allergySubTypeId: isNKALocked ? null : data.allergySubTypeId,
        description: data.description?.trim() || null,
        effectiveDate: data.recordedDate || null,
        lastEffectiveDate: data.endDate || null,
        onSetDate: data.onsetDate || null,
        criticalityId: isNKALocked ? null : data.criticalityId || null,
        verificationStatusCode: data.verificationStatus || null,
        allergyClinicalStatusCode: isNKALocked ? CLINICAL_STATUS.ACTIVE : data.clinicalStatus || null,
        allergyClinicalstatus: isNKALocked ? CLINICAL_STATUS.ACTIVE : data.clinicalStatus || null,
        reactionMapping: isNKALocked ? [] : reactionsList,
        allergyReactions: isNKALocked ? [] : reactionsList,
        PatientLogMessageUserInput: '',
        PatientLogMessage: '',
        actionType,
    });

    const onValidSubmit = async (data) => {
        setSaving(true);
        try {
            const response = await savePatientAllergy(buildSavePayload(data));
            if (!response || response.status === 'success') onClose(true);
            else notifyError(response.message || 'Failed to save allergy.');
        } catch (error) {
            console.error('Failed to save allergy.', error);
            notifyError(error?.message || 'Failed to save allergy. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const openReactionModal = (reaction = null) => {
        setEditingReaction(reaction);
        setReactionModal(true);
    };

    const handleSaveReaction = (reaction) => {
        setReactionsList((previous) => {
            const existingIndex = previous.findIndex((item) => String(item.reactionId) === String(reaction.reactionId));
            if (existingIndex === -1) return [...previous, reaction];
            return previous.map((item, index) => (index === existingIndex ? { ...item, ...reaction } : item));
        });
        setReactionModal(false);
        setEditingReaction(null);
    };

    const handleDeleteReaction = (reactionId) => {
        setReactionsList((previous) => previous.filter((item) => String(item.reactionId) !== String(reactionId)));
    };

    const renderWarningMessages = () => {
        if (isNKALocked) return null;
        return (
            <div className="mt-2 small">
                {verificationStatus === VERIFICATION_STATUS.ENTERED_IN_ERROR && (
                    <div className="alert-message text-danger">
                        <i className="fa fa-exclamation-triangle me-1" />This Allergy Was Entered in Error.
                    </div>
                )}
                {clinicalStatus === CLINICAL_STATUS.INACTIVE && verificationStatus === VERIFICATION_STATUS.REFUTED && (
                    <div className="alert-message text-warning">
                        <i className="fa fa-exclamation-triangle me-1" />This Allergy was marked as Inactive or Refuted.
                    </div>
                )}
                {clinicalStatus === CLINICAL_STATUS.RESOLVED && verificationStatus === VERIFICATION_STATUS.UNCONFIRMED && (
                    <div className="alert-message text-warning">
                        <i className="fa fa-exclamation-triangle me-1" />This Allergy was marked as Resolved or Unconfirmed.
                    </div>
                )}
                {clinicalStatus === CLINICAL_STATUS.RESOLVED && verificationStatus === VERIFICATION_STATUS.REFUTED && (
                    <div className="alert-message text-warning">
                        <i className="fa fa-exclamation-triangle me-1" />This Allergy was marked as Resolved or Refuted.
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="pa-allergies-add-edit-main-container container-fluid animate-fade-in bg-white p-3 border rounded">
            <div className="row mb-2 border-bottom pb-2">
                <div className="d-flex align-items-center gap-2">
                    <button type="button" className="pc-move-list-back back-to-icon btn btn-link p-0 text-dark" onClick={() => onClose(false)} aria-label="Back to allergies list">
                        <span className="mdi mdi-arrow-left custom-pointer fs-4" />
                    </button>
                    <span className="fw-bold pa-allergies-add-edit-container-title">
                        {isRecoverMode ? 'Recover Allergy' : isEditMode ? 'Edit Allergy' : 'Add Allergy'}
                    </span>
                </div>
            </div>

            <form id={fieldId('pa_patient_allergy_add_edit_form')} className="auto-save-form care-plan-data-entry" onSubmit={handleSubmit(onValidSubmit)} noValidate>
                <input type="hidden" id={fieldId('pa_patient_allergy_unique_id')} value={allergyRecord?.allergyId || ''} readOnly />
                <input type="hidden" id={fieldId('pa_patient_allergy_unique_validation')} value={isNKALocked || reactionsList.length || allergySubTypeId ? 1 : 0} readOnly />

                <div className="row g-3">
                    <div className="col-md-4">
                        <label className="form-label fw-bold" htmlFor={fieldId('pa_patient_allergy_type')}>
                            Allergy Type <span className="text-danger">*</span>
                        </label>
                        <Controller
                            name="allergyType"
                            control={control}
                            render={({ field }) => (
                                <Select
                                    inputId={fieldId('pa_patient_allergy_type')}
                                    options={lookups.allergyTypes.map((type) => ({ value: type.code, label: type.description }))}
                                    value={lookups.allergyTypes.map((t) => ({ value: t.code, label: t.description })).find((o) => o.value === field.value) || null}
                                    onChange={(selected) => field.onChange(selected ? selected.value : '')}
                                    isDisabled={isEditMode}
                                    isClearable
                                    placeholder="Select Type"
                                    classNamePrefix="react-select"
                                    styles={{
                                        control: (base, state) => ({
                                            ...base,
                                            borderColor: errors.allergyType ? '#dc3545' : state.isFocused ? '#86b7fe' : '#ced4da',
                                            boxShadow: errors.allergyType ? '0 0 0 0.25rem rgba(220,53,69,.25)' : state.isFocused ? '0 0 0 0.25rem rgba(13,110,253,.25)' : 'none',
                                            '&:hover': { borderColor: errors.allergyType ? '#dc3545' : '#86b7fe' },
                                        }),
                                    }}
                                />
                            )}
                        />
                        <FieldError message={errors.allergyType?.message} />
                    </div>

                    <div className="col-md-4">
                        <label className="form-label fw-bold" htmlFor={fieldId('pa_patient_allergy_sub_type')}>
                            Allergy Subtype <span className="text-danger">*</span>
                        </label>
                        <Controller
                            name="allergySubType"
                            control={control}
                            render={({ field }) => (
                                <AsyncSelect
                                    inputId={fieldId('pa_patient_allergy_sub_type')}
                                    cacheOptions
                                    defaultOptions={false}
                                    loadOptions={(inputValue) => {
                                        if (inputValue.trim().length < LOOKUP_MIN_CHARS) return Promise.resolve([]);
                                        return fetchAllergyLookup({ conceptCategory: 'ALST', searchParameter: inputValue.trim() })
                                            .then((res) =>
                                                (res?.status === 'success' ? res.data || [] : []).map((item) => ({
                                                    value: item.id,
                                                    label: item.conceptName || item.value || item.description || '',
                                                    code: item.code,
                                                }))
                                            )
                                            .catch(() => []);
                                    }}
                                    value={allergySubTypeId ? { value: allergySubTypeId, label: allergySubType } : null}
                                    onChange={(selected) => {
                                        field.onChange(selected ? selected.label : '');
                                        setValue('allergySubTypeId', selected ? String(selected.value) : '');
                                    }}
                                    isDisabled={isNKALocked}
                                    isClearable
                                    placeholder="Type at least 3 characters…"
                                    noOptionsMessage={({ inputValue }) =>
                                        inputValue.length < LOOKUP_MIN_CHARS
                                            ? `Type at least ${LOOKUP_MIN_CHARS} characters to search`
                                            : 'No results found'
                                    }
                                    loadingMessage={() => 'Searching…'}
                                    classNamePrefix="react-select"
                                    styles={{
                                        control: (base, state) => ({
                                            ...base,
                                            borderColor: errors.allergySubType ? '#dc3545' : state.isFocused ? '#86b7fe' : '#ced4da',
                                            boxShadow: errors.allergySubType
                                                ? '0 0 0 0.25rem rgba(220,53,69,.25)'
                                                : state.isFocused ? '0 0 0 0.25rem rgba(13,110,253,.25)' : 'none',
                                            '&:hover': { borderColor: errors.allergySubType ? '#dc3545' : '#86b7fe' },
                                        }),
                                    }}
                                />
                            )}
                        />
                        <FieldError message={errors.allergySubType?.message} />
                    </div>

                    <div className="col-md-4">
                        <label className="form-label fw-bold" htmlFor={fieldId('pa_patient_allergy_criticality')}>Criticality</label>
                        <Controller
                            name="criticalityId"
                            control={control}
                            render={({ field }) => (
                                <select {...field} id={fieldId('pa_patient_allergy_criticality')} className="form-select form-control" disabled={isNKALocked}>
                                    <option value="">Select Criticality</option>
                                    {lookups.criticalities.map((criticality) => (
                                        <option key={criticality.id} value={criticality.id}>{criticality.conceptName}</option>
                                    ))}
                                </select>
                            )}
                        />
                    </div>
                </div>

                <div className="row g-3 mt-2">
                    <div className="col-md-4">
                        <label className="fw-bold d-block mb-1">Clinical Reaction</label>
                        <button type="button" className="btn btn-primary border-radius-button pa-allergies-add-reaction-btn w-100" disabled={isNKALocked} onClick={() => openReactionModal()}>
                            Add Reaction
                        </button>
                        {isNKALocked && (
                            <div className="alert-message mt-2 small text-warning" id={fieldId('pa_allergy_no_known_allergies_or_drug_allergies')}>
                                <i className="fa fa-exclamation-triangle me-1" />Reactions cannot be added when NKA/NKDA is selected.
                            </div>
                        )}
                        <div className="pa-allergies-show-added-reaction-list-container mt-2">
                            {reactionsList.length === 0 && !isNKALocked && (
                                <div className="small text-muted p-2 border rounded">No reactions added.</div>
                            )}
                            {reactionsList.map((reaction) => (
                                <div key={reaction.reactionId} className="pa-patient-selected-allergies-reaction-list-wrapper p-2 mb-2 shadow-sm small">
                                    <div className="d-flex justify-content-between align-items-center">
                                        <span><strong>{reaction.reaction}</strong> ({reaction.severity || '-'})</span>
                                        <span className="d-flex gap-2">
                                            <button type="button" className="btn btn-link p-0" onClick={() => openReactionModal(reaction)} title="Edit reaction">
                                                <i className="fa-regular fa-pencil" />
                                            </button>
                                            <button type="button" className="btn btn-link p-0 text-danger" onClick={() => handleDeleteReaction(reaction.reactionId)} title="Delete reaction">
                                                <i className="fa-regular fa-trash-can" />
                                            </button>
                                        </span>
                                    </div>
                                    {(reaction.lastOccuranceDate || reaction.notes) && (
                                        <div className="pa-reaction-detail-panel mt-2 pt-2 border-top">
                                            {reaction.lastOccuranceDate && <div><span className="label-name">Last Occurrence: </span>{reaction.lastOccuranceDate}</div>}
                                            {reaction.notes && <div><span className="label-name">Notes: </span>{reaction.notes}</div>}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="col-md-4">
                        <label className="form-label fw-bold" htmlFor={fieldId('pa_patient_allergy_clinical_status')}>
                            Clinical Status {!isNKALocked && <span className="text-danger">*</span>}
                        </label>
                        <Controller
                            name="clinicalStatus"
                            control={control}
                            render={({ field }) => (
                                <select {...field} id={fieldId('pa_patient_allergy_clinical_status')} className="form-select form-control pa-clinical-status" disabled={isNKALocked}>
                                    <option value="">Select Status</option>
                                    {lookups.clinicalStatuses.map((status) => (
                                        <option key={status.code} value={status.code}>{status.description}</option>
                                    ))}
                                </select>
                            )}
                        />
                        <FieldError message={errors.clinicalStatus?.message} />
                    </div>

                    <div className="col-md-4">
                        <label className="form-label fw-bold" htmlFor={fieldId('pa_patient_allergy_verification_status')}>Verification Status</label>
                        <Controller
                            name="verificationStatus"
                            control={control}
                            render={({ field }) => (
                                <select {...field} id={fieldId('pa_patient_allergy_verification_status')} className="form-select form-control" disabled={isNKALocked}>
                                    <option value="">Select Verification Status</option>
                                    {lookups.verificationStatuses.map((status) => (
                                        <option key={status.code || status.id} value={status.code}>{status.conceptName || status.description}</option>
                                    ))}
                                </select>
                            )}
                        />
                        {renderWarningMessages()}
                    </div>
                </div>

                <div className="row g-3 mt-2">
                    <div className="col-md-4">
                        <label className="form-label fw-bold" htmlFor={fieldId('pa_patient_allergy_onset_date')}>Onset Date &amp; Time</label>
                        <Controller
                            name="onsetDate"
                            control={control}
                            render={({ field }) => (
                                <FlatpickrDateTimeInput
                                    id={fieldId('pa_patient_allergy_onset_date')}
                                    value={field.value}
                                    onChange={field.onChange}
                                    enableTime
                                    dateFormat="m-d-Y h:i K"
                                    placeholder="MM-DD-YYYY hh:mm AM/PM"
                                />
                            )}
                        />
                        <FieldError message={errors.onsetDate?.message} />
                    </div>

                    <div className="col-md-4">
                        <label className="form-label fw-bold" htmlFor={fieldId('pa_patient_allergy_recorded_date')}>Recorded Date &amp; Time</label>
                        <Controller
                            name="recordedDate"
                            control={control}
                            render={({ field }) => (
                                <FlatpickrDateTimeInput
                                    id={fieldId('pa_patient_allergy_recorded_date')}
                                    value={field.value}
                                    onChange={field.onChange}
                                    enableTime
                                    dateFormat="m-d-Y h:i K"
                                    placeholder="MM-DD-YYYY hh:mm AM/PM"
                                />
                            )}
                        />
                    </div>

                    <div className="col-md-4">
                        <label className="form-label fw-bold" htmlFor={fieldId('pa_patient_allergy_end_date')}>Date of Resolution</label>
                        <Controller
                            name="endDate"
                            control={control}
                            render={({ field }) => (
                                <FlatpickrDateTimeInput
                                    id={fieldId('pa_patient_allergy_end_date')}
                                    value={field.value}
                                    onChange={field.onChange}
                                    enableTime
                                    dateFormat="m-d-Y h:i K"
                                    placeholder="MM-DD-YYYY hh:mm AM/PM"
                                    disabled={isEndDateDisabled}
                                />
                            )}
                        />
                        <FieldError message={errors.endDate?.message} />
                    </div>
                </div>

                <div className="row g-3 mt-2">
                    <div className="col-md-12">
                        <label className="form-label fw-bold" htmlFor={fieldId('pa_patient_allergy_description')}>
                            Description {!isNKALocked && <span className="text-danger">*</span>}
                        </label>
                        <Controller
                            name="description"
                            control={control}
                            render={({ field }) => (
                                <textarea
                                    {...field}
                                    id={fieldId('pa_patient_allergy_description')}
                                    className="form-control"
                                    style={{ height: 115 }}
                                    disabled={isNKALocked}
                                    maxLength={5000}
                                />
                            )}
                        />
                        <div className="small text-muted text-end">{description?.length || 0}/5000</div>
                        <FieldError message={errors.description?.message} />
                    </div>

                    <input type="hidden" id={fieldId('pa_patient_allergy_change_log_message')} value="" readOnly />
                </div>

                <div className="row mt-4 pt-3 border-top m-0">
                    <div className="form-add-edit-button-group d-flex justify-content-end gap-2 p-0">
                        <button type="button" className="btn btn-outline-secondary px-4 border-radius-button cancel bs-modal-cancel-btn" onClick={() => onClose(false)} disabled={saving}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary px-4 border-radius-button bs-modal-save-btn" disabled={saving}>
                            {saving ? 'Saving...' : isRecoverMode ? 'Recover Allergy' : 'Save Allergy'}
                        </button>
                    </div>
                </div>
            </form>

            <Dialog
                visible={reactionModal}
                onHide={() => { setReactionModal(false); setEditingReaction(null); }}
                header={editingReaction ? 'Edit Allergy Reaction' : 'Allergy Reaction'}
                style={{ width: '680px' }}
                breakpoints={{ '768px': '95vw' }}
                className="pa-reaction-dialog"
                pt={{ header: { className: 'pa-reaction-dialog-header' } }}
            >
                <PatientAllergiesReactions
                    patientId={patientId}
                    lookups={lookups}
                    existingReactionIds={existingReactionIds}
                    editReaction={editingReaction}
                    onSave={handleSaveReaction}
                    onCancel={() => { setReactionModal(false); setEditingReaction(null); }}
                />
            </Dialog>
        </div>
    );
};

export default PatientAllergiesAddEdit;