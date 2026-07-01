const PatientListFilter = () => (<div className="offcanvas offcanvas-end" data-bs-scroll="true" data-bs-backdrop="false" tabIndex={-1} id="offcanvasRight" aria-labelledby="offcanvasRightLabel">
  <div className="offcanvas-header py-1">
    <h5 className="offcanvas-title" id="offcanvasRightLabel">Filters</h5>
    <button type="button" className="btn-close" data-bs-dismiss="offcanvas" aria-label="Close" />
  </div>
  <div className="offcanvas-body pt-1">
    <div className="row mr-none ml-none flex-column">
      <div className="col-md pl-none mb-1">
        <div className="form-group m-none">
          <label className="fw-bold" htmlFor="filter_records_length">Show</label>
          <select id="filter_records_length" name="filter_records_length" className="filter-inputs form-control" defaultValue="10">
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>
      <div className="col-md pl-none mb-1">
        <div className="form-group m-none">
          <label className="fw-bold" htmlFor="subscribed_product_filter">Program</label>
          <select id="subscribed_product_filter" name="subscribed_product_filter" className="filter-inputs text-capitalize form-control" />
        </div>
      </div>
      <div className="col-md pl-none mb-1">
        <div className="form-group m-none">
          <label className="fw-bold" htmlFor="search_patients_by_column">Search By</label>
          <select id="search_patients_by_column" name="search_patients_by_column" className="filter-inputs text-capitalize form-control form-select" defaultValue="PATIENNAME">
            <option value="PATIENNAME">Patient Name</option>
            <option value="PATIENTEMR">External EMR Id</option>
            <option value="MEDICARNM">Medicare Number</option>
            <option value="PATIENTMOB">Phone Number</option>
            <option value="PATIENMAIL">Email</option>
          </select>
        </div>
      </div>
      <div className="col-md pl-none mb-1">
        <div className="form-group m-none">
          <label className="fw-bold" htmlFor="search_patients_by_column_value">Search Value</label>
          <input type="text" id="search_patients_by_column_value" name="search_patients_by_column_value" className="filter-inputs text-capitalize form-control clearInput" />
        </div>
      </div>
    </div>
  </div>
</div>);
export default PatientListFilter;
