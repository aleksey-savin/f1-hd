import ICalendarLink from 'react-icalendar-link';

import Button from 'react-bootstrap/Button';

export const AddToCalendar = (props) => {
    const { title, company, num } = props.ticket;

    const calEvent = {
        startTime: new Date(props.start),
        endTime: new Date(props.finish),
        description: `Ссылка: ${import.meta.env.VITE_ADDRESS}/tickets/${num}`,
        title: title,
        location: company.alias,
    };

    return (
        <>
            <ICalendarLink as={Button} event={calEvent}>
                Добавить в календарь
            </ICalendarLink>
        </>
    );
};
