import { projectRoot } from "../dir-helper.js";
import { fccLicenseEn } from "../../db/schema.js";
import { addRowHash, importFile, valuesType } from "./import-helper.js";
import { createHash } from "crypto";

export async function importEn() {
  const columns: string[] = [
    "recordType",
    "uniqueSystemIdentifier",
    "ulsFileNumber",
    "ebfNumber",
    "callSign",
    "entityType",
    "licenseeId",
    "entityName",
    "firstName",
    "mi",
    "lastName",
    "suffix",
    "phone",
    "fax",
    "email",
    "streetAddress",
    "city",
    "state",
    "zipCode",
    "poBox",
    "attentionLine",
    "sgin",
    "frn",
    "applicantTypeCode",
    "applicantTypeOther",
    "statusCode",
    "statusDate",
  ];

  importFile(
    fccLicenseEn,
    columns,
    `${projectRoot}/downloads/EN.dat`,
    alterValues,
  );

  function alterValues(row: string, dataRow: string[], values: valuesType) {
    addRowHash(row, dataRow, values);

    const zipCode = values.zipCode as string;

    if (zipCode.length > 5) {
      values.zipCode = `${zipCode.slice(0, 5)}-${zipCode.slice(5)}`;
    }

    const streetAddress = values.streetAddress as string;
    const poBox = values.poBox as string;
    const address: string[] = [];

    if (streetAddress) {
      address.push(streetAddress);
    }

    if (poBox) {
      address.push(`PO Box ${poBox}`);
    }

    values.streetAddress = address.join(", ");

    values.addressHash = createHash("sha1")
      .update(
        `${values.streetAddress}${values.city}${values.state}${values.zipCode}`,
      )
      .digest("hex");
  }
}
