import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from 'primereact/sidebar';
import PatientProblemsList from './PatientProblemsList';
import PatientProblemsAddEdit from './PatientProblemsAddEdit';
import { fetchProblemStatusMetadata } from '../../../services/lookupService';
import patientCache from '../../../utils/patientCache';
import { useNotify } from '../../../context/NotificationContext';
import '../allergies/PatientAllergies.css';
import './PatientProblems.css';
const EMPTY_METADATA = { clinicalStatuses: [], verificationStatuses: [] };
const PatientProblems = ({ patientId }) => {
    const [viewMode, setViewMode] = useState('LIST');
    const [recordType, setRecordType] = useState('active');
    const [showDeleted, setShowDeleted] = useState(false);
    const [filterVisible, setFilterVisible] = useState(false);
    const [selectedRecord, setSelectedRecord] = useState(null);
    const [actionType, setActionType] = useState('create');
    const [searchTerm, setSearchTerm] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    const [statusMetadata, setStatusMetadata] = useState(EMPTY_METADATA);
    const [metadataLoading, setMetadataLoading] = useState(false);
    const [filterForm, setFilterForm] = useState({ type: '' });
    const { notifyError } = useNotify();
    useEffect(() => {
        let ignore = false;
        const loadMetadata = async () => {
            const cached = patientCache.get('problemStatusMetadata');
            if (cached) {
                setStatusMetadata(cached);
                return;
            }
            setMetadataLoading(true);
            try {
                const metadata = await fetchProblemStatusMetadata();
                if (ignore)
                    return;
                setStatusMetadata(metadata);
                patientCache.set('problemStatusMetadata', metadata);
            }
            catch (error) {
                console.error('Failed to load problem status metadata.', error);
                if (!ignore)
                    notifyError(error?.message || 'Unable to load problem reference data.');
            }
            finally {
                if (!ignore)
                    setMetadataLoading(false);
            }
        };
        loadMetadata();
        return () => {
            ignore = true;
        };
    }, [notifyError]);
    const openAddEdit = useCallback((record = null, action = 'create') => {
        setSelectedRecord(record);
        setActionType(action);
        setViewMode('ADD_EDIT');
    }, []);
    const closeAddEdit = useCallback((shouldRefresh = false) => {
        setViewMode('LIST');
        setSelectedRecord(null);
        setActionType('create');
        if (shouldRefresh)
            setRefreshKey((key) => key + 1);
    }, []);
    const handleRecordTypeChange = (type) => {
        setRecordType(type);
        setShowDeleted(false);
    };
    const handleApplyFilters = () => {
        setFilterVisible(false);
        setRefreshKey((key) => key + 1);
    };
    const handleResetFilters = () => {
        setFilterForm({ type: '' });
        setRefreshKey((key) => key + 1);
    };
    return (<div className="pp-problems-section-main-container" id={`patient_problems_hub_${patientId}`}>
      {viewMode === 'LIST' ? (<div className="pp-problems-list-main-container">
          <div className="pp-problems-main-header container-fluid p-0 my-2">
            <div className="pp-problems-header-input-container d-flex justify-content-between align-items-center w-100 flex-wrap gap-2">
              <div className="pp-problems-header-input-group d-flex align-items-center gap-2 flex-wrap">
                <div className="active-history-toggle-group">
                  <ul className="nav nav-pills active-history-toggle-group-list toggle-group-small" role="tablist">
                    <li className="nav-item active-history-toggle-list">
                      <button className={`nav-link active-history-nav-link small ${recordType === 'active' ? 'active' : ''}`} onClick={() => handleRecordTypeChange('active')} type="button">Active</button>
                    </li>
                    <li className="nav-item active-history-toggle-list">
                      <button className={`nav-link active-history-nav-link small ${recordType === 'history' ? 'active' : ''}`} onClick={() => handleRecordTypeChange('history')} type="button">History</button>
                    </li>
                  </ul>
                </div>

                {recordType === 'history' && (<div className="pp-problems-header-recover-delete-record-group form-check ms-2">
                    <input type="checkbox" id={`pa_diagnosis_recover_deleted_input_checkbox_${patientId}`} className="form-check-input" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)}/>
                    <label className="form-check-label" htmlFor={`pa_diagnosis_recover_deleted_input_checkbox_${patientId}`}>Show Deleted Records</label>
                  </div>)}

                <div className="pp-problems-header-search-input-group position-relative ms-2">
                  <input id={`pa_search_problem_input_${patientId}`} type="text" className="form-control pa-search-problem-input" placeholder="Search problems" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)}/>
                  <i className="fa fa-solid fa-magnifying-glass position-absolute end-0 top-50 translate-middle-y me-2 text-muted"/>
                </div>
              </div>

              <div className="pp-problems-header-action-icons-container d-flex align-items-center gap-2">
                <button type="button" className="btn border-0 d-flex align-items-center gap-2 btn-md section-filter-icon-btn" onClick={() => setFilterVisible(true)}>
                  <span className="mdi mdi-filter-variant"/>Filter
                </button>
                {recordType !== 'history' && (<button type="button" className="pa-add-new-problem-btn btn btn-primary btn-md border-radius-button text-nowrap" id={`pp_add_new_problem_btn_${patientId}`} onClick={() => openAddEdit(null, 'create')}>
                    <span className="mdi mdi-plus"/> Add Problem
                  </button>)}
              </div>
            </div>
          </div>

          {metadataLoading && <div className="small text-muted mb-2">Loading problem master data...</div>}

          <div className="pp-problems-list-body">
            <PatientProblemsList patientId={patientId} recordType={recordType} showDeleted={showDeleted} searchTerm={searchTerm} filterType={filterForm.type} refreshKey={refreshKey} onEdit={(record) => openAddEdit(record, 'edit')} onRecoverEdit={(record) => openAddEdit(record, 'recover')} onRefresh={() => setRefreshKey((key) => key + 1)}/>
          </div>
        </div>) : (<div className="pp-problems-add-edit-main-container-wrapper">
          <PatientProblemsAddEdit patientId={patientId} problemRecord={selectedRecord} actionType={actionType} recordType={recordType} statusMetadata={statusMetadata} onClose={closeAddEdit}/>
        </div>)}

      <Sidebar visible={filterVisible} position="right" onHide={() => setFilterVisible(false)} className="pa-allergy-header-offcanvas-container offcanvas offcanvas-end" id={`pp_diagnosis_filter_acute_chronic_options_${patientId}`} header={<h5>Filter</h5>}>
        <form onSubmit={(event) => { event.preventDefault(); handleApplyFilters(); }}>
          <div className="form-group mb-3">
            <label htmlFor={`problem_section_diagnosis_type_options_${patientId}`} className="form-label">Type</label>
            <select id={`problem_section_diagnosis_type_options_${patientId}`} className="form-select form-select-sm" value={filterForm.type} onChange={(event) => setFilterForm({ type: event.target.value })}>
              <option value="">Select type</option>
              <option value="ACUT">Acute</option>
              <option value="CHRO">Chronic</option>
            </select>
          </div>
          <div className="mt-4 form-group d-flex justify-content-between">
            <button type="button" className="btn btn-outline-secondary border-radius-button" onClick={handleResetFilters}>Reset</button>
            <button type="submit" className="btn btn-primary border-radius-button" style={{ width: 120 }}>Apply</button>
          </div>
        </form>
      </Sidebar>
    </div>);
};
export default PatientProblems;
