import { addIcons } from 'ionicons';
import {
  cartOutline, bagHandleOutline, cubeOutline, walletOutline, peopleOutline, constructOutline,
  globeOutline, logOutOutline, addOutline, chevronForwardOutline, checkmarkDoneOutline, trendingUpOutline,
  timeOutline, alertCircleOutline, documentTextOutline, sparklesOutline, closeOutline, businessOutline,
  locationOutline, sendOutline, arrowForwardOutline, cashOutline, layersOutline, printOutline,
} from 'ionicons/icons';

/** Registers every ionicon the ERP screens use (module icons come from MODULES[].ionIcon). */
export function registerErpIcons() {
  addIcons({
    cartOutline, bagHandleOutline, cubeOutline, walletOutline, peopleOutline, constructOutline,
    globeOutline, logOutOutline, addOutline, chevronForwardOutline, checkmarkDoneOutline, trendingUpOutline,
    timeOutline, alertCircleOutline, documentTextOutline, sparklesOutline, closeOutline, businessOutline,
    locationOutline, sendOutline, arrowForwardOutline, cashOutline, layersOutline, printOutline,
  });
}
