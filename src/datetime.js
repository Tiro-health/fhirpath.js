var engine = {};
const types = require('./types');
const constants = require('./constants');
const util = require('./utilities');
const FP_Date = types.FP_Date;
const FP_DateTime = types.FP_DateTime;
const FP_Time = types.FP_Time;

// Precision constraints by type
const datePrecisions = ['year', 'month', 'week', 'day'];
const timePrecisions = ['hour', 'minute', 'second', 'millisecond'];
const dateTimePrecisions = [...datePrecisions, ...timePrecisions];

// Map precision strings to numeric indices for comparison
const precisionToIndex = {
  year: 0, month: 1, week: 2, day: 2,
  hour: 3, minute: 4, second: 5, millisecond: 6
};

/**
 *  Implements FHIRPath now().
 */
engine.now = function(){
  if (!constants.now) {
    // return new FP_DateTime((new Date()).toISOString());
    // The above would construct an FP_DateTime with a timezone of "Z", which
    // would not make a difference for computation, but if the end result of an
    // expression is "now()", then it would look different when output to a user.
    // Construct it ourselves to preserve timezone
    var now = constants.nowDate; // a JS Date
    var isoStr = FP_DateTime.isoDateTime(now);
    constants.now = new FP_DateTime(isoStr);
  }
  return constants.now;
};


/**
 *  Implements FHIRPath today().  See comments in now(). This does not
 *  include a timezone offset.
 */
engine.today = function(){
  if (!constants.today) {
    // Construct the string ourselves to preserve timezone
    var now = constants.nowDate; // a JS Date
    var isoStr = FP_Date.isoDate(now);
    constants.today = new FP_Date(isoStr);
  }
  return constants.today;
};

/**
 *  Implements FHIRPath timeOfDay().  See comments in now(). This does not
 *  include a timezone offset.
 */
engine.timeOfDay = function() {
  if (!constants.timeOfDay) {
    // Construct the string ourselves to preserve timezone
    const now = constants.nowDate; // a JS Date
    const isoStr = FP_DateTime.isoTime(now);
    constants.timeOfDay = new FP_Time(isoStr);
  }
  return constants.timeOfDay;
};


/**
 * Helper to validate and extract a date/time value from a collection.
 * @param {Array} coll - The input collection
 * @param {string} fnName - Function name for error messages
 * @returns {FP_Date|FP_DateTime|FP_Time|null} The extracted value or null if empty
 */
function extractDateTimeValue(coll, fnName) {
  if (util.isEmpty(coll) || coll.length === 0) {
    return null;
  }
  if (coll.length > 1) {
    throw new Error(fnName + ': Expected singleton, got ' + coll.length + ' items');
  }
  const val = util.valData(coll[0]);
  if (val == null) {
    return null;
  }
  if (!(val instanceof FP_Date) && !(val instanceof FP_DateTime) && !(val instanceof FP_Time)) {
    throw new Error(fnName + ': Expected date, dateTime, or time value');
  }
  return val;
}

/**
 * Validates that the precision is allowed for the given type.
 * @param {FP_Date|FP_DateTime|FP_Time} value - The date/time value
 * @param {string} precision - The precision string
 * @param {string} fnName - Function name for error messages
 * @returns {boolean} True if valid
 */
function validatePrecision(value, precision, fnName) {
  let allowedPrecisions;
  if (value instanceof FP_Time) {
    allowedPrecisions = timePrecisions;
  } else if (value.constructor === FP_Date) {
    // FP_Date only allows date-level precisions (year, month, week, day)
    allowedPrecisions = datePrecisions;
  } else {
    // FP_DateTime and FP_Instant allow full datetime precisions
    allowedPrecisions = dateTimePrecisions;
  }

  if (!allowedPrecisions.includes(precision)) {
    throw new Error(fnName + ': Invalid precision "' + precision + '" for type');
  }
  return true;
}

/**
 * Checks if the value has sufficient precision for the requested calculation.
 * @param {FP_Date|FP_DateTime|FP_Time} value - The date/time value
 * @param {string} precision - The requested precision
 * @returns {boolean} True if the value has sufficient precision
 */
function hasSufficientPrecision(value, precision) {
  const valuePrecision = value._getPrecision();
  const requestedPrecisionIndex = precisionToIndex[precision];

  // For FP_Time, precision 0 = hour, 1 = minute, 2 = second, 3 = millisecond
  // For FP_DateTime/FP_Date, precision 0 = year, 1 = month, 2 = day, 3 = hour, etc.
  if (value instanceof FP_Time) {
    // Map time precision to the dateTimePrecisions index offset
    const timePrecisionOffset = 3; // hour starts at index 3 in dateTimePrecisions
    return (valuePrecision + timePrecisionOffset) >= requestedPrecisionIndex;
  }

  return valuePrecision >= requestedPrecisionIndex;
}

/**
 * Calculates the number of whole calendar periods between two date/time values.
 * This is the "duration" calculation - counts complete periods elapsed.
 *
 * @param {Date} fromDate - The start date
 * @param {Date} toDate - The end date
 * @param {string} precision - The precision (year, month, week, day, hour, minute, second, millisecond)
 * @returns {number} The number of whole periods
 */
function calculateDuration(fromDate, toDate, precision) {
  const fromTime = fromDate.getTime();
  const toTime = toDate.getTime();
  const diffMs = toTime - fromTime;

  switch (precision) {
    case 'year': {
      let years = toDate.getFullYear() - fromDate.getFullYear();
      // Check if we haven't reached the anniversary yet
      const anniversaryThisYear = new Date(toDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(),
        fromDate.getHours(), fromDate.getMinutes(), fromDate.getSeconds(), fromDate.getMilliseconds());
      if (diffMs >= 0) {
        if (toDate < anniversaryThisYear) {
          years--;
        }
      } else {
        if (toDate > anniversaryThisYear) {
          years++;
        }
      }
      return years;
    }

    case 'month': {
      let months = (toDate.getFullYear() - fromDate.getFullYear()) * 12 +
        (toDate.getMonth() - fromDate.getMonth());
      // Check if we haven't reached the day-of-month yet
      if (diffMs >= 0) {
        if (toDate.getDate() < fromDate.getDate()) {
          months--;
        } else if (toDate.getDate() === fromDate.getDate()) {
          // Same day of month, check time
          const fromTimeOfDay = fromDate.getHours() * 3600000 + fromDate.getMinutes() * 60000 +
            fromDate.getSeconds() * 1000 + fromDate.getMilliseconds();
          const toTimeOfDay = toDate.getHours() * 3600000 + toDate.getMinutes() * 60000 +
            toDate.getSeconds() * 1000 + toDate.getMilliseconds();
          if (toTimeOfDay < fromTimeOfDay) {
            months--;
          }
        }
      } else {
        if (toDate.getDate() > fromDate.getDate()) {
          months++;
        } else if (toDate.getDate() === fromDate.getDate()) {
          const fromTimeOfDay = fromDate.getHours() * 3600000 + fromDate.getMinutes() * 60000 +
            fromDate.getSeconds() * 1000 + fromDate.getMilliseconds();
          const toTimeOfDay = toDate.getHours() * 3600000 + toDate.getMinutes() * 60000 +
            toDate.getSeconds() * 1000 + toDate.getMilliseconds();
          if (toTimeOfDay > fromTimeOfDay) {
            months++;
          }
        }
      }
      return months;
    }

    case 'week': {
      // Weeks are simply days / 7
      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      return Math.trunc(days / 7);
    }

    case 'day': {
      return Math.trunc(diffMs / (1000 * 60 * 60 * 24));
    }

    case 'hour': {
      return Math.trunc(diffMs / (1000 * 60 * 60));
    }

    case 'minute': {
      return Math.trunc(diffMs / (1000 * 60));
    }

    case 'second': {
      return Math.trunc(diffMs / 1000);
    }

    case 'millisecond': {
      return Math.trunc(diffMs);
    }

    default:
      throw new Error('Unsupported precision: ' + precision);
  }
}

/**
 * Calculates the number of boundaries crossed between two date/time values.
 * This is the "difference" calculation - counts boundary crossings.
 *
 * @param {Date} fromDate - The start date
 * @param {Date} toDate - The end date
 * @param {string} precision - The precision (year, month, week, day, hour, minute, second, millisecond)
 * @returns {number} The number of boundaries crossed
 */
function calculateDifference(fromDate, toDate, precision) {
  const fromTime = fromDate.getTime();
  const toTime = toDate.getTime();
  const sign = toTime >= fromTime ? 1 : -1;

  // Ensure from is before to for calculation, then apply sign at end
  const [earlier, later] = sign > 0 ? [fromDate, toDate] : [toDate, fromDate];

  switch (precision) {
    case 'year': {
      return sign * (later.getFullYear() - earlier.getFullYear());
    }

    case 'month': {
      return sign * ((later.getFullYear() - earlier.getFullYear()) * 12 +
        (later.getMonth() - earlier.getMonth()));
    }

    case 'week': {
      // Count Sunday boundaries crossed
      // Normalize both dates to start of their respective weeks (Sunday)
      const getWeekStart = (d) => {
        const day = d.getDay(); // 0 = Sunday
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - day);
        weekStart.setHours(0, 0, 0, 0);
        return weekStart;
      };
      const earlierWeekStart = getWeekStart(earlier);
      const laterWeekStart = getWeekStart(later);
      const diffMs = laterWeekStart.getTime() - earlierWeekStart.getTime();
      return sign * Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    }

    case 'day': {
      // Truncate to day and count
      const truncateToDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const earlierDay = truncateToDay(earlier);
      const laterDay = truncateToDay(later);
      const diffMs = laterDay.getTime() - earlierDay.getTime();
      return sign * Math.floor(diffMs / (24 * 60 * 60 * 1000));
    }

    case 'hour': {
      const truncateToHour = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());
      const earlierHour = truncateToHour(earlier);
      const laterHour = truncateToHour(later);
      const diffMs = laterHour.getTime() - earlierHour.getTime();
      return sign * Math.floor(diffMs / (60 * 60 * 1000));
    }

    case 'minute': {
      const truncateToMinute = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(),
        d.getHours(), d.getMinutes());
      const earlierMin = truncateToMinute(earlier);
      const laterMin = truncateToMinute(later);
      const diffMs = laterMin.getTime() - earlierMin.getTime();
      return sign * Math.floor(diffMs / (60 * 1000));
    }

    case 'second': {
      const truncateToSecond = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(),
        d.getHours(), d.getMinutes(), d.getSeconds());
      const earlierSec = truncateToSecond(earlier);
      const laterSec = truncateToSecond(later);
      const diffMs = laterSec.getTime() - earlierSec.getTime();
      return sign * Math.floor(diffMs / 1000);
    }

    case 'millisecond': {
      return sign * (later.getTime() - earlier.getTime());
    }

    default:
      throw new Error('Unsupported precision: ' + precision);
  }
}

/**
 * Checks type compatibility between two date/time values.
 * @param {FP_Date|FP_DateTime|FP_Time} inputVal - First value
 * @param {FP_Date|FP_DateTime|FP_Time} targetVal - Second value
 * @param {string} fnName - Function name for error messages
 */
function checkTypeCompatibility(inputVal, targetVal, fnName) {
  const inputIsTime = inputVal instanceof FP_Time;
  const targetIsTime = targetVal instanceof FP_Time;

  // Time can only be compared with Time
  if (inputIsTime !== targetIsTime) {
    throw new Error(fnName + ': Type mismatch - cannot compare Time with Date/DateTime');
  }

  // For Date/DateTime, we allow both FP_Date and FP_DateTime to be compared
  // since FP_Date extends FP_DateTime
}

/**
 * Implements FHIRPath duration().
 * Returns the number of whole calendar periods at the specified precision
 * between the input value and the value argument.
 *
 * @param {Array} coll - The input collection (should contain a single date/datetime/time)
 * @param {FP_Date|FP_DateTime|FP_Time} value - The target value to calculate duration to
 * @param {string} precision - The precision (year, month, week, day, hour, minute, second, millisecond)
 * @returns {number|Array} The number of whole periods, or empty array if cannot be computed
 */
engine.duration = function(coll, value, precision) {
  const inputVal = extractDateTimeValue(coll, 'duration');
  if (inputVal === null) {
    return [];
  }

  // Extract the target value - it may be an FP_Type directly, wrapped in array, or other
  let targetVal;
  if (value instanceof FP_Date || value instanceof FP_DateTime || value instanceof FP_Time) {
    targetVal = value;
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }
    if (value.length > 1) {
      throw new Error('duration: Expected singleton for value argument, got ' + value.length + ' items');
    }
    targetVal = util.valData(value[0]);
  } else {
    targetVal = util.valData(value);
  }

  if (targetVal == null) {
    return [];
  }

  // Ensure targetVal is an FP_Type
  if (!(targetVal instanceof FP_Date) && !(targetVal instanceof FP_DateTime) && !(targetVal instanceof FP_Time)) {
    throw new Error('duration: Expected date, dateTime, or time value for second argument');
  }

  // Check type compatibility
  checkTypeCompatibility(inputVal, targetVal, 'duration');

  // Validate precision for the type
  validatePrecision(inputVal, precision, 'duration');

  // Check if both values have sufficient precision
  if (!hasSufficientPrecision(inputVal, precision) || !hasSufficientPrecision(targetVal, precision)) {
    return [];
  }

  // Get the JavaScript Date objects
  const inputDate = inputVal._getDateObj();
  const targetDate = targetVal._getDateObj();

  return calculateDuration(inputDate, targetDate, precision);
};


/**
 * Implements FHIRPath difference().
 * Returns the number of boundaries crossed for the specified precision
 * between the input value and the value argument.
 *
 * @param {Array} coll - The input collection (should contain a single date/datetime/time)
 * @param {FP_Date|FP_DateTime|FP_Time} value - The target value to calculate difference to
 * @param {string} precision - The precision (year, month, week, day, hour, minute, second, millisecond)
 * @returns {number|Array} The number of boundaries crossed, or empty array if cannot be computed
 */
engine.difference = function(coll, value, precision) {
  const inputVal = extractDateTimeValue(coll, 'difference');
  if (inputVal === null) {
    return [];
  }

  // Extract the target value - it may be an FP_Type directly, wrapped in array, or other
  let targetVal;
  if (value instanceof FP_Date || value instanceof FP_DateTime || value instanceof FP_Time) {
    targetVal = value;
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }
    if (value.length > 1) {
      throw new Error('difference: Expected singleton for value argument, got ' + value.length + ' items');
    }
    targetVal = util.valData(value[0]);
  } else {
    targetVal = util.valData(value);
  }

  if (targetVal == null) {
    return [];
  }

  // Ensure targetVal is an FP_Type
  if (!(targetVal instanceof FP_Date) && !(targetVal instanceof FP_DateTime) && !(targetVal instanceof FP_Time)) {
    throw new Error('difference: Expected date, dateTime, or time value for second argument');
  }

  // Check type compatibility
  checkTypeCompatibility(inputVal, targetVal, 'difference');

  // Validate precision for the type
  validatePrecision(inputVal, precision, 'difference');

  // Check if both values have sufficient precision
  if (!hasSufficientPrecision(inputVal, precision) || !hasSufficientPrecision(targetVal, precision)) {
    return [];
  }

  // Get the JavaScript Date objects
  const inputDate = inputVal._getDateObj();
  const targetDate = targetVal._getDateObj();

  return calculateDifference(inputDate, targetDate, precision);
};

module.exports = engine;
