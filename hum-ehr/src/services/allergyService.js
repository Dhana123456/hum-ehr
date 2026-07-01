import ENDPOINTS from './endpoints';
import { apiPost } from './apiClient';
export const normalizeResponseList = (response) => {
	if (!response)
		return [];
	if (Array.isArray(response))
		return response;
	if (Array.isArray(response.data))
		return response.data;
	return [];
}; 
export const buildAllergyListRequest = ({ patientId, searchTerm = '', advancedFilters = {}, }) => ({
	patientId,
	search: searchTerm?.trim() || null,
	filter: {
		allergyType: advancedFilters.allergyType || null,
		subType: advancedFilters.subTypeCode || advancedFilters.subType || null,
		reaction: advancedFilters.reactionCode || advancedFilters.reaction || null,
		severity: advancedFilters.severity || null,
	},
});
export const fetchPatientAllergies = async ({ patientId, recordType = 'active', showDeleted = false, searchTerm = '', advancedFilters = {}, }) => {
	const request = buildAllergyListRequest({ patientId, searchTerm, advancedFilters });
	const response = await apiPost(ENDPOINTS.allergy.list(recordType), request);
	const data = normalizeResponseList(response);
	const records = recordType === 'history'
		? data.filter((item) => (showDeleted ? item.invalidFlag === 'Y' : item.invalidFlag !== 'Y'))
		: data;
	return { records, rawRecords: data, request, response };
};
export const savePatientAllergy = (payload) => apiPost(ENDPOINTS.allergy.save, payload);
export const deletePatientAllergy = (payload) => apiPost(ENDPOINTS.allergy.invalid, payload);
export const recoverPatientAllergy = (payload) => apiPost(ENDPOINTS.allergy.recover, payload);
const buildStatusChangePayload = (activeFlag, { patientId, allergyRecord, changeLogNotes = '' }) => ({
	activeFlag,
	patientId,
	careplanId: allergyRecord?.careplanId ?? null,
	allergyId: allergyRecord?.allergyId,
	lastEffectiveDate: allergyRecord?.lastEffectiveDate ?? null,
	PatientLogMessageUserInput: changeLogNotes,
	PatientLogMessage: changeLogNotes,
});
export const buildDeletePayload = (args) => buildStatusChangePayload('Y', args);
export const buildRecoverPayload = (args) => buildStatusChangePayload('N', args);
const allergyService = {
	normalizeResponseList,
	buildAllergyListRequest,
	fetchPatientAllergies,
	savePatientAllergy,
	deletePatientAllergy,
	recoverPatientAllergy,
	buildDeletePayload,
	buildRecoverPayload,
};
export default allergyService;
