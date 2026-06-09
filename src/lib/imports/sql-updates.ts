import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../db-helper.js";
import logger from "../logger.js";
import { GEOCODE_STATUS_PO_BOX } from "../constants.js";

export async function truncateTable(tableName: string) {
  const db = await getDb();
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableName}`));
  await closeDb();

  const msg = `${tableName} truncated`;
  console.log(msg);
  logger.info(msg);
}

// Calculate and update a hash for the joined table result to use when
// updating the entity. Note: MySQL specific code.
export async function updateHash() {
  const db = await getDb();

  const rawSql = `
    UPDATE fcc_license_hd hd
    INNER JOIN fcc_license_en en ON en.unique_system_identifier = hd.unique_system_identifier
    INNER JOIN fcc_license_am am ON am.unique_system_identifier = hd.unique_system_identifier
    SET hd.total_hash = SHA1(CONCAT(hd.row_hash, en.row_hash, am.row_hash))`;

  const result = await db.execute(sql.raw(rawSql));
  await closeDb();

  const msg = `${result[0].affectedRows} hashes updated`;
  console.log(msg);
  logger.info(msg);
}

export async function updateLicenses() {
  const db = await getDb();

  const rawSql = `
    UPDATE ham_station hs
    INNER JOIN fcc_license_hd hd ON hd.call_sign = hs.callsign
    INNER JOIN fcc_license_en en ON en.unique_system_identifier = hd.unique_system_identifier
    INNER JOIN fcc_license_am am ON am.unique_system_identifier = hd.unique_system_identifier
    SET
    hs.first_name = en.first_name,
    hs.middle_name = en.mi,
    hs.last_name = en.last_name,
    hs.suffix = en.suffix,
    hs.organization = CASE WHEN applicant_type_code != 'I' THEN en.entity_name ELSE NULL END,
    hs.operator_class = am.operator_class,
    hs.previous_callsign = am.previous_callsign,
    hs.total_hash = hd.total_hash,
    hs.address_hash = en.address_hash,
    hs.changed = unix_timestamp()
    WHERE hd.license_status = 'A'
  `;

  const result = await db.execute(sql.raw(rawSql));
  await closeDb();

  const msg = `${result[0].affectedRows} existing FCC licenses updated`;
  console.log(msg);
  logger.info(msg);
}

export async function importNewLicenses() {
  const db = await getDb();

  const rawSql = `
    INSERT INTO ham_station
    (uuid, langcode, callsign, first_name, middle_name, last_name, suffix,
    organization, operator_class, previous_callsign, total_hash, address_hash,
    user_id, status, created, changed)
    SELECT uuid() AS uuid, 'en' AS langcode, hd.call_sign AS callsign, en.first_name, en.mi AS middle_name, en.last_name, en.suffix,
    CASE WHEN applicant_type_code != 'I' THEN en.entity_name ELSE NULL END AS organization,
    am.operator_class, am.previous_callsign, hd.total_hash, en.address_hash,
    1 AS user_id, 1 AS status, unix_timestamp() AS created, unix_timestamp() AS changed
    FROM fcc_license_hd hd
    INNER JOIN fcc_license_en en ON en.unique_system_identifier = hd.unique_system_identifier
    INNER JOIN fcc_license_am am ON am.unique_system_identifier = hd.unique_system_identifier
    WHERE hd.license_status = 'A'
    AND NOT EXISTS (SELECT id FROM ham_station hs WHERE hs.callsign = hd.call_sign)
  `;

  const result = await db.execute(sql.raw(rawSql));
  await closeDb();

  const msg = `${result[0].affectedRows} new FCC licenses imported`;
  console.log(msg);
  logger.info(msg);
}

export async function importNewAddresses() {
  const db = await getDb();

  const rawSql = `
    INSERT INTO ham_address
    (uuid, langcode, hash,
    address__address_line1, address__locality, address__administrative_area,
    address__postal_code, address__country_code, geocode_status,
    user_id, status, created, changed)
    SELECT UUID() AS uuid, 'en' AS langcode, address_hash as hash,
    en.street_address AS address__address_line1, en.city AS address__locality, en.state AS address__administrative_area,
    en.zip_code AS address__postal_code, 'US' AS address__country_code, 0 AS geocode_status,
    1 AS user_id, 1 AS status, unix_timestamp() AS created, unix_timestamp() AS changed
    FROM fcc_license_en en
    INNER JOIN fcc_license_hd hd ON hd.unique_system_identifier = en.unique_system_identifier AND hd.license_status = 'A'
    WHERE NOT EXISTS (SELECT id FROM ham_address ha WHERE ha.hash = en.address_hash)
    AND en.unique_system_identifier = (
    SELECT MIN(en2.unique_system_identifier)
    FROM fcc_license_en en2 INNER JOIN fcc_license_hd hd2 ON hd2.unique_system_identifier = en2.unique_system_identifier
    WHERE hd2.license_status = 'A' AND en2.address_hash = en.address_hash)
  `;

  const result = await db.execute(sql.raw(rawSql));
  await closeDb();

  const msg = `${result[0].affectedRows} new FCC addresses imported`;
  console.log(msg);
  logger.info(msg);
}

export async function deleteInactiveStations() {
  const db = await getDb();

  const rawSql = `
    DELETE ham_station
    FROM ham_station
    LEFT JOIN fcc_license_hd hd ON hd.call_sign = ham_station.callsign AND hd.license_status = 'A'
    WHERE hd.unique_system_identifier IS NULL
  `;

  const result = await db.execute(sql.raw(rawSql));
  await closeDb();

  const msg = `${result[0].affectedRows} inactive FCC stations deleted`;
  console.log(msg);
  logger.info(msg);
}

export async function deleteInactiveAddresses() {
  const db = await getDb();

  const rawSql = `
    DELETE ham_address
    FROM ham_address
    LEFT JOIN ham_station hs ON hs.address_hash = ham_address.hash
    WHERE hs.id IS NULL
  `;

  const result = await db.execute(sql.raw(rawSql));
  await closeDb();

  const msg = `${result[0].affectedRows} inactive FCC addresses deleted`;
  console.log(msg);
  logger.info(msg);
}

export async function deleteInactiveLocations() {
  const db = await getDb();

  const rawSql = `
    DELETE ham_location
    FROM ham_location
    LEFT JOIN ham_address ha ON ha.location_id = ham_location.id
    WHERE ha.id IS NULL
  `;

  const result = await db.execute(sql.raw(rawSql));
  await closeDb();

  const msg = `${result[0].affectedRows} inactive FCC locations deleted`;
  console.log(msg);
  logger.info(msg);
}

export async function setPoBox() {
  const db = await getDb();

  const rawSql = `
    UPDATE ham_address
    SET geocode_status = ${GEOCODE_STATUS_PO_BOX}
    WHERE address__address_line1 LIKE 'PO Box%'
    AND (geocode_provider IS NULL OR geocode_provider != 'mn')
  `;

  const result = await db.execute(sql.raw(rawSql));
  await closeDb();

  const msg = `${result[0].affectedRows} addresses set as PO Box`;
  console.log(msg);
  logger.info(msg);
}
