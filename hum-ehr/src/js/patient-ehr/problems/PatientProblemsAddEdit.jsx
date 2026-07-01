import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncSelect from 'react-select/async';
import { buildProblemSavePayload, savePatientProblem } from '../../../services/problemService';
import { fetchProblemIcdLookup, fetchProblemSnomedForIcd } from '../../../services/lookupService';
import { getFormattedIcdCode } from '../../../utils/commonUtility';
import { getSaveOutcome } from '../../../utils/saveResponse';
import { LOOKUP_MIN_CHARS } from '../../../constants/timing';
import FlatpickrDateTimeInput from '../../../components/common/FlatpickrDateTimeInput';
const createDefaultForm = () => ({
    icdCode: '',
    icdDescription: '',
    snomedCode: '',
    snomedDescription: '',
    diagnosisType: '',
    clinicalStatus: '',
    verificationStatus: '',
    diagnosisDate: '',
    recordedDate: '',
    endDate: '',
    notes: '',
    changeLogNotes: '',
});
// Status classification by description keyword — the legacy code keys off the
// humcode response *order*; matching the human-readable label is more robust
// than hard-coding uncertain codes for recurrence/relapse/differential/etc.
const descOf = (statuses, code) => {
    const found = statuses.find((status) => String(status.code) === String(code));
    return (found?.description || '').toLowerCase();
};
const PatientProblemsAddEdit = ({ patientId, problemRecord, actionType, statusMetadata, onClose, }) => {
    const [form, setForm] = useState(createDefaultForm);
    const [snomedOptions, setSnomedOptions] = useState([]);
    const [snomedLocked, setSnomedLocked] = useState(false);
    const [noSnomed, setNoSnomed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState({});
    // Server save outcome for a 200 response whose envelope status is
    // warning/failure (kept separate from field validation so it can carry tone).
    const [saveError, setSaveError] = useState(null);
    const isEditMode = !!problemRecord?.diagnosisId;
    const isRecoverMode = actionType === 'recover';
    const clinicalStatuses = statusMetadata?.clinicalStatuses || [];
    const verificationStatuses = statusMetadata?.verificationStatuses || [];
    const fieldId = (base) => `${base}_${patientId}`;
    const clearFieldError = (key) => setErrors((previous) => {
        if (!previous[key])
            return previous;
        const next = { ...previous };
        delete next[key];
        return next;
    });
    const updateForm = (key, value) => {
        setForm((previous) => ({ ...previous, [key]: value }));
        clearFieldError(key);
    };
    // ---- current status classification ----
    const clinicalDesc = descOf(clinicalStatuses, form.clinicalStatus);
    const verificationDesc = descOf(verificationStatuses, form.verificationStatus);
    const clinical = {
        active: clinicalDesc.includes('active') && !clinicalDesc.includes('inactive'),
        inactive: clinicalDesc.includes('inactive'),
        resolved: clinicalDesc.includes('resolv'),
        remission: clinicalDesc.includes('remission'),
        recurrence: clinicalDesc.includes('recurrence'),
        relapse: clinicalDesc.includes('relapse'),
    };
    const verification = {
        unconfirmed: verificationDesc.includes('unconfirm'),
        refuted: verificationDesc.includes('refut'),
        differential: verificationDesc.includes('differential') || verificationDesc.includes('provisional'),
        enteredError: verificationDesc.includes('error'),
    };
    const endDateEnabled = clinical.inactive || clinical.resolved;
    const clinicalRequired = !verification.enteredError;
    // ---- option visibility (mirrors the legacy clinical<->verification rules) ----
    const isVerificationAllowed = (status) => {
        const d = (status.description || '').toLowerCase();
        const isRefuted = d.includes('refut');
        const isError = d.includes('error');
        if (clinical.active || clinical.recurrence || clinical.relapse || clinical.remission)
            return !isRefuted && !isError;
        if (clinical.inactive || clinical.resolved)
            return !isError;
        if (!form.clinicalStatus)
            return isError; // clinical empty => only entered-in-error
        return true;
    };
    const isClinicalAllowed = (status) => {
        if (verification.enteredError)
            return false; // no clinical status when entered-in-error
        if (verification.refuted) {
            const d = (status.description || '').toLowerCase();
            return d.includes('recurrence') || d.includes('remission');
        }
        return true;
    };
    const visibleClinical = clinicalStatuses.filter(isClinicalAllowed);
    const visibleVerification = verificationStatuses.filter(isVerificationAllowed);
    // ---- warning message (the eight documented status combinations) ----
    const warningMessage = useMemo(() => {
        if (!form.clinicalStatus && verification.enteredError)
            return { tone: 'error', text: 'This Problem Was Entered in Error.' };
        if (clinical.inactive && verification.differential)
            return { tone: 'warning', text: 'This Problem was marked as Inactive or Differential.' };
        if (clinical.inactive && verification.refuted)
            return { tone: 'warning', text: 'This Problem was marked as Inactive or Refuted.' };
        if (clinical.remission && verification.unconfirmed)
            return { tone: 'warning', text: 'This Problem was marked as Remission or Unconfirmed.' };
        if (clinical.remission && verification.differential)
            return { tone: 'warning', text: 'This Problem was marked as Remission or Differential.' };
        if (clinical.resolved && verification.unconfirmed)
            return { tone: 'warning', text: 'This Problem was marked as Resolved or Unconfirmed.' };
        if (clinical.resolved && verification.refuted)
            return { tone: 'warning', text: 'This Problem was marked as Resolved or Refuted.' };
        if (clinical.resolved && verification.differential)
            return { tone: 'warning', text: 'This Problem was marked as Resolved or Differential.' };
        return null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.clinicalStatus, form.verificationStatus]);
    const loadSnomedForIcd = useCallback(async (icdCode, prefillCode = '', prefillDesc = '') => {
        setNoSnomed(false);
        setSnomedLocked(false);
        setSnomedOptions([]);
        if (prefillCode) {
            // Editing an existing record: lock to the stored SNOMED value.
            setSnomedOptions([{ snomedId: prefillCode, snomedDesc: prefillDesc }]);
            setSnomedLocked(true);
            return;
        }
        try {
            const response = await fetchProblemSnomedForIcd(icdCode);
            const list = response?.status === 'success' ? response.data || [] : [];
            if (!list.length) {
                setNoSnomed(true);
                return;
            }
            setSnomedOptions(list);
            if (list.length === 1) {
                setSnomedLocked(true);
                setForm((previous) => ({ ...previous, snomedCode: String(list[0].snomedId), snomedDescription: list[0].snomedDesc || '' }));
            }
        }
        catch (error) {
            console.error('Failed to fetch SNOMED codes.', error);
            setNoSnomed(true);
        }
    }, []);
    useEffect(() => {
        if (!isEditMode || !problemRecord) {
            setForm(createDefaultForm());
            setSnomedOptions([]);
            setNoSnomed(false);
            setSnomedLocked(false);
            return;
        }
        const icdCode = getFormattedIcdCode(problemRecord.icdCode || '');
        setForm({
            icdCode,
            icdDescription: problemRecord.icdDescription || '',
            snomedCode: problemRecord.snomedCode ? String(problemRecord.snomedCode) : '',
            snomedDescription: problemRecord.snomedDesc || '',
            diagnosisType: problemRecord.diagnosisType || '',
            clinicalStatus: problemRecord.clinicalStatusCode || '',
            verificationStatus: problemRecord.verificationStatusCode || '',
            diagnosisDate: problemRecord.dateOfDiagnosis || '',
            recordedDate: problemRecord.recordedDate || '',
            endDate: problemRecord.dateOfResolution || '',
            notes: problemRecord.notes || '',
            changeLogNotes: '',
        });
        if (problemRecord.snomedCode)
            loadSnomedForIcd(icdCode, String(problemRecord.snomedCode), problemRecord.snomedDesc || '');
    }, [problemRecord, isEditMode, loadSnomedForIcd]);
    const handleIcdSelect = (item) => {
        setForm((previous) => ({
            ...previous,
            icdCode: item.code,
            icdDescription: item.description,
            diagnosisType: item.chronicIndicator === 1 || item.chronicIndicator === '1' ? 'CHRO' : 'ACUT',
            snomedCode: '',
            snomedDescription: '',
        }));
        clearFieldError('icdCode');
        clearFieldError('diagnosisType');
        loadSnomedForIcd(item.code);
    };
    const handleSnomedChange = (event) => {
        const code = event.target.value;
        const option = snomedOptions.find((item) => String(item.snomedId) === String(code));
        setForm((previous) => ({ ...previous, snomedCode: code, snomedDescription: option?.snomedDesc || '' }));
        clearFieldError('snomedCode');
    };
    const handleClinicalStatusChange = (value) => {
        setForm((previous) => {
            const next = { ...previous, clinicalStatus: value };
            const vStatus = verificationStatuses.find((status) => String(status.code) === String(previous.verificationStatus));
            if (vStatus) {
                const d = (vStatus.description || '').toLowerCase();
                const cd = descOf(clinicalStatuses, value);
                const cActiveLike = (cd.includes('active') && !cd.includes('inactive')) || cd.includes('remission') || cd.includes('recurrence') || cd.includes('relapse');
                if (cActiveLike && (d.includes('refut') || d.includes('error')))
                    next.verificationStatus = '';
                else if ((cd.includes('inactive') || cd.includes('resolv')) && d.includes('error'))
                    next.verificationStatus = '';
            }
            const cd = descOf(clinicalStatuses, value);
            if (!(cd.includes('inactive') || cd.includes('resolv')))
                next.endDate = '';
            return next;
        });
        clearFieldError('clinicalStatus');
        clearFieldError('endDate');
    };
    const validateForm = () => {
        const nextErrors = {};
        if (!form.icdCode || !form.icdDescription)
            nextErrors.icdCode = 'Please select a problem from the ICD search list.';
        if (!noSnomed && snomedOptions.length > 0 && !form.snomedCode)
            nextErrors.snomedCode = 'SNOMED Code is required.';
        if (!form.diagnosisType)
            nextErrors.diagnosisType = 'Problem Type is required.';
        if (clinicalRequired && !form.clinicalStatus)
            nextErrors.clinicalStatus = 'Clinical Status is required.';
        if (endDateEnabled && !form.endDate)
            nextErrors.endDate = 'Date of Resolution is required.';
        if (form.endDate && !form.diagnosisDate)
            nextErrors.diagnosisDate = 'Date of Diagnosis is required when Date of Resolution is entered.';
        if (!form.changeLogNotes.trim())
            nextErrors.changeLogNotes = 'Change log message is required.';
        return nextErrors;
    };
    const handleFormSubmit = async (event) => {
        event.preventDefault();
        setSaveError(null);
        const validationErrors = validateForm();
        setErrors(validationErrors);
        if (Object.keys(validationErrors).length)
            return;
        setSaving(true);
        try {
            const response = await savePatientProblem(buildProblemSavePayload({ patientId, form, problemRecord }));
            // The save endpoint returns HTTP 200 even when it rejects the record:
            // only status === 'success' means saved. A 'warning'/'failure' body
            // (e.g. a duplicate problem) keeps the form open and the server message
            // is surfaced under the ICD search field, as the legacy form did.
            const outcome = getSaveOutcome(response, 'This problem could not be saved. Please review the details and try again.');
            if (outcome.ok) {
                onClose(true);
                return;
            }
            setSaveError(outcome);
        }
        catch (error) {
            console.error('Failed to save problem.', error);
            setSaveError({ tone: 'error', message: error?.message || 'Failed to save problem. Please try again.' });
        }
        finally {
            setSaving(false);
        }
    };
    return (<div className="pp-problems-add-edit-main-container container-fluid animate-fade-in bg-white p-3 border rounded">
      <div className="row mb-2 border-bottom pb-2">
        <div className="d-flex align-items-center gap-2">
          <button type="button" className="back-to-icon btn btn-link p-0 text-dark" onClick={() => onClose(false)} aria-label="Back to problems list">
            <span className="mdi mdi-arrow-left custom-pointer fs-4"/>
          </button>
          <span className="fw-bold">{isRecoverMode ? 'Recover Problem' : isEditMode ? 'Edit Problem' : 'Add Problem'}</span>
        </div>
      </div>

      <form id={fieldId('pp_patient_problem_add_edit_form')} className="care-plan-data-entry" onSubmit={handleFormSubmit} noValidate>
        {/* Row 1 — identification (col-md-4: 3 per row on desktop, matching the allergy form). */}
        <div className="row g-3">
          <div className="col-12 col-sm-6 col-md-4">
            <label className="form-label fw-bold" htmlFor={fieldId('pp_patient_problem_icd_code')}>Search By ICD Code (or) Description <span className="text-danger">*</span></label>
            <AsyncSelect
              inputId={fieldId('pp_patient_problem_icd_code')}
              cacheOptions
              defaultOptions={false}
              isDisabled={isEditMode}
              loadOptions={(inputValue) => {
                if (inputValue.trim().length < LOOKUP_MIN_CHARS) return Promise.resolve([]);
                return fetchProblemIcdLookup(inputValue.trim())
                  .then((res) => (res?.status === 'success' ? res.data || [] : []).map((item) => ({
                    value: getFormattedIcdCode(item.icdCode || ''),
                    label: `${getFormattedIcdCode(item.icdCode || '')} - ${item.icdDescription || ''}`,
                    code: getFormattedIcdCode(item.icdCode || ''),
                    description: item.icdDescription || '',
                    chronicIndicator: item.chronicIndicator,
                  })))
                  .catch(() => []);
              }}
              value={form.icdCode ? { value: form.icdCode, label: `${form.icdCode} - ${form.icdDescription}` } : null}
              onChange={(selected) => {
                if (selected) {
                  handleIcdSelect(selected);
                } else {
                  setForm((prev) => ({ ...prev, icdCode: '', icdDescription: '', diagnosisType: '', snomedCode: '', snomedDescription: '' }));
                  setSnomedOptions([]);
                  setNoSnomed(false);
                  setSnomedLocked(false);
                }
              }}
              isClearable
              placeholder="Type at least 3 characters..."
              noOptionsMessage={({ inputValue }) => inputValue.length < LOOKUP_MIN_CHARS ? `Type at least ${LOOKUP_MIN_CHARS} characters` : 'No results found'}
              loadingMessage={() => 'Searching...'}
              classNamePrefix="react-select"
            />
            {errors.icdCode && <div className="small text-danger mt-1">{errors.icdCode}</div>}
            {saveError && (<div className={`small mt-1 ${saveError.tone === 'warning' ? 'text-warning' : 'text-danger'}`} id={fieldId('pp_patient_problem_save_error')}>
                <i className="fa fa-exclamation-triangle me-1"/>{saveError.message}
              </div>)}
          </div>
          <div className="col-12 col-sm-6 col-md-4">
            <label className="form-label fw-bold" htmlFor={fieldId('pp_patient_problem_snomed_code')}>SNOMED Code <span className="text-danger">*</span></label>
            <select id={fieldId('pp_patient_problem_snomed_code')} className="form-select form-control" value={form.snomedCode} disabled={snomedLocked || noSnomed || !snomedOptions.length} onChange={handleSnomedChange}>
              <option value="">Select SNOMED Code</option>
              {snomedOptions.map((option) => <option key={option.snomedId} value={String(option.snomedId)}>{option.snomedId} - {option.snomedDesc}</option>)}
            </select>
            {noSnomed && <div className="small text-warning mt-1">There is no SNOMED CT code linked to {form.icdCode}.</div>}
            {errors.snomedCode && <div className="small text-danger mt-1">{errors.snomedCode}</div>}
          </div>
          <div className="col-12 col-sm-6 col-md-4">
            <label className="form-label fw-bold" htmlFor={fieldId('pp_patient_problem_type')}>Type <span className="text-danger">*</span></label>
            <select id={fieldId('pp_patient_problem_type')} className="form-select form-control" value={form.diagnosisType} onChange={(event) => updateForm('diagnosisType', event.target.value)}>
              <option value="">Select Diagnosis Type</option>
              <option value="CHRO">Chronic</option>
              <option value="ACUT">Acute</option>
            </select>
            {errors.diagnosisType && <div className="small text-danger mt-1">{errors.diagnosisType}</div>}
          </div>
        </div>

        {/* Row 2 — clinical & verification status. */}
        <div className="row g-3 mt-1">
          <div className="col-12 col-sm-6 col-md-4">
            <label className="form-label fw-bold" htmlFor={fieldId('pp_patient_problem_clinical_status')}>Clinical Status {clinicalRequired && <span className="text-danger">*</span>}</label>
            <select id={fieldId('pp_patient_problem_clinical_status')} className="form-select form-control pp-clinical-status" value={form.clinicalStatus} onChange={(event) => handleClinicalStatusChange(event.target.value)}>
              <option value="">Select Clinical Status</option>
              {visibleClinical.map((status) => <option key={status.code} value={status.code}>{status.description}</option>)}
            </select>
            {errors.clinicalStatus && <div className="small text-danger mt-1">{errors.clinicalStatus}</div>}
          </div>
          <div className="col-12 col-sm-6 col-md-4">
            <label className="form-label fw-bold" htmlFor={fieldId('pp_patient_problem_verification_status')}>Verification Status</label>
            <select id={fieldId('pp_patient_problem_verification_status')} className="form-select form-control" value={form.verificationStatus} onChange={(event) => updateForm('verificationStatus', event.target.value)}>
              <option value="">Select Verification Status</option>
              {visibleVerification.map((status) => <option key={status.code} value={status.code}>{status.description}</option>)}
            </select>
            {warningMessage && (<div className={`small mt-1 ${warningMessage.tone === 'error' ? 'text-danger' : 'text-warning'}`}>
                <i className="fa fa-exclamation-triangle me-1"/>{warningMessage.text}
              </div>)}
          </div>
        </div>

        {/* Row 3 — the three dates. */}
        <div className="row g-3 mt-1">
          <div className="col-12 col-sm-6 col-md-4">
            <label className="form-label fw-bold" htmlFor={fieldId('pp_patient_problem_diagnosis_date')}>Date of Diagnosis</label>
            <FlatpickrDateTimeInput id={fieldId('pp_patient_problem_diagnosis_date')} value={form.diagnosisDate} onChange={(value) => updateForm('diagnosisDate', value)} enableTime dateFormat="m-d-Y h:i K" placeholder="MM-DD-YYYY hh:mm AM/PM"/>
            {errors.diagnosisDate && <div className="small text-danger mt-1">{errors.diagnosisDate}</div>}
          </div>
          <div className="col-12 col-sm-6 col-md-4">
            <label className="form-label fw-bold" htmlFor={fieldId('pp_patient_problem_recorded_date')}>Recorded Date &amp; Time</label>
            <FlatpickrDateTimeInput id={fieldId('pp_patient_problem_recorded_date')} value={form.recordedDate} onChange={(value) => updateForm('recordedDate', value)} enableTime dateFormat="m-d-Y h:i K" placeholder="MM-DD-YYYY hh:mm AM/PM"/>
          </div>
          <div className="col-12 col-sm-6 col-md-4">
            <label className="form-label fw-bold" htmlFor={fieldId('pp_patient_problem_end_date')}>Date of Resolution {endDateEnabled && <span className="text-danger">*</span>}</label>
            <FlatpickrDateTimeInput id={fieldId('pp_patient_problem_end_date')} value={form.endDate} onChange={(value) => updateForm('endDate', value)} enableTime dateFormat="m-d-Y h:i K" placeholder="MM-DD-YYYY hh:mm AM/PM" disabled={!endDateEnabled}/>
            {errors.endDate && <div className="small text-danger mt-1">{errors.endDate}</div>}
          </div>
        </div>

        {/* Row 3 — the read-only descriptions span wider. */}
        <div className="row g-3 mt-1">
          <div className="col-12 col-md-6">
            <label className="form-label fw-bold" htmlFor={fieldId('pp_patient_problem_icd_description')}>ICD Description <span className="text-danger">*</span></label>
            <textarea id={fieldId('pp_patient_problem_icd_description')} className="form-control" style={{ height: 90 }} value={form.icdDescription} disabled maxLength={5000}/>
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label fw-bold" htmlFor={fieldId('pp_patient_problem_snomed_description')}>SNOMED Description</label>
            <textarea id={fieldId('pp_patient_problem_snomed_description')} className="form-control" style={{ height: 90 }} value={form.snomedDescription} disabled maxLength={5000}/>
          </div>
        </div>

        <div className="row g-3 mt-1">
          <div className="col-12">
            <label className="form-label fw-bold" htmlFor={fieldId('pp_patient_problem_notes')}>Notes</label>
            <textarea id={fieldId('pp_patient_problem_notes')} className="form-control" style={{ height: 90 }} value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} maxLength={5000}/>
          </div>
          <div className="col-12">
            <label className="form-label fw-bold text-danger" htmlFor={fieldId('pp_patient_problem_change_log_message')}>Audit Change Log Message <span className="text-danger">*</span></label>
            <input type="text" className="form-control border-danger" id={fieldId('pp_patient_problem_change_log_message')} value={form.changeLogNotes} onChange={(event) => updateForm('changeLogNotes', event.target.value)} placeholder="Reason required for clinical audit logs"/>
            {errors.changeLogNotes && <div className="small text-danger mt-1">{errors.changeLogNotes}</div>}
          </div>
        </div>

        <div className="row mt-4 pt-3 border-top m-0">
          <div className="d-flex justify-content-end gap-2 p-0">
            <button type="button" className="btn btn-secondary px-4 rounded-pill" onClick={() => onClose(false)} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary px-4 rounded-pill" disabled={saving}>{saving ? 'Saving...' : isRecoverMode ? 'Recover Problem' : 'Save'}</button>
          </div>
        </div>
      </form>
    </div>);
};
export default PatientProblemsAddEdit;
