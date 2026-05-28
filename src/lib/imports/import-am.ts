import { projectRoot } from "../dir-helper.js";
import { fccLicenseAm } from "../../db/schema.js";
import { addRowHash, importFile } from "./import-helper.js";

export async function importAm() {
  const columns: string[] = [
    "recordType",
    "uniqueSystemIdentifier",
    "ulsFileNum",
    "ebfNumber",
    "callsign",
    "operatorClass",
    "groupCode",
    "regionCode",
    "trusteeCallsign",
    "trusteeIndicator",
    "physicianCertification",
    "veSignature",
    "systematicCallsignChange",
    "vanityCallsignChange",
    "vanityRelationship",
    "previousCallsign",
    "previousOperatorClass",
    "trusteeName",
  ];

  importFile(
    fccLicenseAm,
    columns,
    `${projectRoot}/downloads/AM.dat`,
    addRowHash,
  );
}
