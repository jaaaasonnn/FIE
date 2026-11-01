'use client'

// The date picker and its stylesheet, in a file of their own so that pages fetch them only when a date
// field is opened (components/ui/LazyDatePicker.tsx). Nothing else should import this file.
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

export default DatePicker
