import Badge from 'react-bootstrap/Badge';

import { RiBuilding2Line } from 'react-icons/ri';

const CompanyBadge = (props) => {
    return (
        <h3>
            <Badge className='mb-2 w-100' bg='secondary'>
                <RiBuilding2Line /> {props.ticket.company?.alias}
            </Badge>
        </h3>
    );
};

export default CompanyBadge;
