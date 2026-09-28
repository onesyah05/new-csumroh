-- Nama event business_messaging yang diterima Meta (Contact/Lead ditolak, subcode 2804066).
UPDATE `meta_capi_logs` SET `event_name` = 'LeadSubmitted' WHERE `event_name` = 'Contact';
UPDATE `meta_capi_logs` SET `event_name` = 'QualifiedLead' WHERE `event_name` = 'Lead';
